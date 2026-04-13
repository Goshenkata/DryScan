import crypto from "node:crypto";
import Parser from "tree-sitter";
import Java from "tree-sitter-java";
import debug from "debug";
import { LanguageExtractor } from "./LanguageExtractor";
import { IndexUnit, IndexUnitType } from "../types";
import { indexConfig } from "../config/indexConfig";
import { DryConfig } from "../types";
import { configStore } from "../config/configStore";
import { BLOCK_HASH_ALGO } from "../const";

const log = debug("DryScan:JavaExtractor");

export class JavaExtractor implements LanguageExtractor {
  readonly id = "java";
  readonly exts = [".java"];

  private parser: Parser;
  private readonly repoPath: string;
  private config?: DryConfig;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.parser = new Parser();
    this.parser.setLanguage(Java);
  }

  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return this.exts.some((ext) => lower.endsWith(ext));
  }

  async extractFromText(fileRelPath: string, source: string): Promise<IndexUnit[]> {
    if (!source.trim()) return [];

    this.config = await configStore.get(this.repoPath);

    let tree: Parser.Tree;
    try {
      tree = this.parser.parse(source);
    } catch (err) {
      log("Skipping %s: tree-sitter parse failed (%s)", fileRelPath, (err as Error).message);
      return [];
    }
    const units: IndexUnit[] = [];

    const visit = (node: Parser.SyntaxNode, currentClass?: IndexUnit) => {
      if (this.isClassNode(node)) {
        const className = this.getClassName(node, source) || "<anonymous>";
        if (this.isDtoClass(node, source, className)) {
          return;
        }
        const startLine = node.startPosition.row;
        const endLine = node.endPosition.row;
        const classLength = endLine - startLine;
        const skipClass = this.shouldSkip(IndexUnitType.CLASS, className, classLength);
        const classId = this.buildId(IndexUnitType.CLASS, fileRelPath, className, startLine, endLine);
        const code = this.stripComments(this.stripClassBody(node, source));
        const classUnit: IndexUnit = {
          id: classId,
          name: className,
          filePath: fileRelPath,
          startLine,
          endLine,
          code,
          unitType: IndexUnitType.CLASS,
          children: [],
        };
        if (!skipClass) {
          units.push(classUnit);
        }

        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) visit(child, skipClass ? undefined : classUnit);
        }
        return;
      }

      if (this.isFunctionNode(node)) {
        const fnUnit = this.buildFunctionUnit(node, source, fileRelPath, currentClass);
        const fnLength = fnUnit.endLine - fnUnit.startLine;
        const bodyNode = this.getFunctionBody(node);
        const fnArity = this.getNodeArity(node);
        const skipFunction = this.shouldSkip(IndexUnitType.FUNCTION, fnUnit.name, fnLength, fnArity);

        if (skipFunction) {
          return;
        }

        units.push(fnUnit);

        if (bodyNode) {
          const blocks = this.extractBlocks(bodyNode, source, fileRelPath, fnUnit);
          units.push(...blocks);
        }
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) visit(child, currentClass);
      }
    };

    visit(tree.rootNode);

    //remove duplicates if any
    return this.removeDuplicates(units);
  }

  unitLabel(unit: IndexUnit): string | null {
    if (unit.unitType === IndexUnitType.CLASS) return unit.filePath;
    if (unit.unitType === IndexUnitType.FUNCTION) return this.canonicalFunctionSignature(unit);
    if (unit.unitType === IndexUnitType.BLOCK) return this.normalizedBlockHash(unit);
    return unit.name;
  }

  private isClassNode(node: Parser.SyntaxNode): boolean {
    return node.type === "class_declaration";
  }

  private getClassName(node: Parser.SyntaxNode, source: string): string | null {
    const nameNode = node.childForFieldName?.("name");
    return nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : null;
  }

  private isFunctionNode(node: Parser.SyntaxNode): boolean {
    return node.type === "method_declaration" || node.type === "constructor_declaration";
  }

  private getFunctionName(node: Parser.SyntaxNode, source: string, parentClass?: IndexUnit): string | null {
    const nameNode = node.childForFieldName?.("name");
    const nameText = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : "<anonymous>";
    return parentClass ? `${parentClass.name}.${nameText}` : nameText;
  }

  private getFunctionBody(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    return node.childForFieldName?.("body") ?? null;
  }

  private isBlockNode(node: Parser.SyntaxNode): boolean {
    return node.type === "block";
  }

  private getMethodBodiesForClass(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const bodies: Parser.SyntaxNode[] = [];
    const classBody = node.children.find(child => child.type === "class_body");
    if (!classBody) return bodies;
    
    for (let i = 0; i < classBody.namedChildCount; i++) {
      const child = classBody.namedChild(i);
      if (!child) continue;
      if (child.type === "method_declaration" || child.type === "constructor_declaration") {
        const body = child.childForFieldName?.("body");
        if (body) bodies.push(body);
      }
    }
    return bodies;
  }

  private canonicalFunctionSignature(unit: IndexUnit): string {
    const arity = this.extractArity(unit.code);
    return `${unit.name}(arity:${arity})`;
  }

  private normalizedBlockHash(unit: IndexUnit): string {
    const normalized = this.normalizeCode(unit.code);
    return crypto.createHash(BLOCK_HASH_ALGO).update(normalized).digest("hex");
  }

  private shouldSkip(unitType: IndexUnitType, name: string, lineCount: number, arity?: number): boolean {
    if (!this.config) {
      throw new Error("Config not loaded before skip evaluation");
    }
    const config = this.config;
    const minLines = unitType === IndexUnitType.BLOCK
      ? Math.max(indexConfig.blockMinLines, config.minBlockLines ?? 0)
      : config.minLines;
    const belowMin = minLines > 0 && lineCount < minLines;
    const trivial = unitType === IndexUnitType.FUNCTION && this.isTrivialFunction(name, arity ?? 0);
    return belowMin || trivial;
  }

  /**
   * A function is trivial if it follows a simple accessor pattern:
   * - getters/isers: name matches get[A-Z] or is[A-Z] with exactly 0 parameters
   * - setters: name matches set[A-Z] with at most 1 parameter
   * Methods like getUserById(Long id) have arity > 0 and are NOT trivial.
   */
  private isTrivialFunction(fullName: string, arity: number): boolean {
    const simpleName = fullName.split(".").pop() || fullName;
    const isGetter = /^(get|is)[A-Z]/.test(simpleName) && arity === 0;
    const isSetter = /^set[A-Z]/.test(simpleName) && arity <= 1;
    return isGetter || isSetter;
  }

  /** Counts the formal parameters of a method or constructor node. */
  private getNodeArity(node: Parser.SyntaxNode): number {
    const params = node.childForFieldName?.("parameters");
    if (!params) return 0;
    return params.namedChildren.filter(c => c.type === "formal_parameter" || c.type === "spread_parameter").length;
  }

  private isDtoClass(node: Parser.SyntaxNode, source: string, className: string): boolean {
    const classBody = node.children.find((child) => child.type === "class_body");
    if (!classBody) return false;

    let hasField = false;

    for (let i = 0; i < classBody.namedChildCount; i++) {
      const child = classBody.namedChild(i);
      if (!child) continue;

      if (child.type === "field_declaration") {
        hasField = true;
        continue;
      }

      if (child.type.includes("annotation")) {
        continue;
      }

      if (child.type === "method_declaration" || child.type === "constructor_declaration") {
        const simpleName = this.getSimpleFunctionName(child, source);
        const fullName = `${className}.${simpleName}`;
        const arity = this.getNodeArity(child);
        if (!this.isTrivialFunction(fullName, arity)) {
          return false;
        }
        continue;
      }

      return false;
    }

    return hasField;
  }

  private getSimpleFunctionName(node: Parser.SyntaxNode, source: string): string {
    const nameNode = node.childForFieldName?.("name");
    return nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : "<anonymous>";
  }

  private buildFunctionUnit(
    node: Parser.SyntaxNode,
    source: string,
    file: string,
    parentClass?: IndexUnit
  ): IndexUnit {
    const name = this.getFunctionName(node, source, parentClass) || "<anonymous>";
    const startLine = node.startPosition.row;
    const endLine = node.endPosition.row;
    const id = this.buildId(IndexUnitType.FUNCTION, file, name, startLine, endLine);
    const unit: IndexUnit = {
      id,
      name,
      filePath: file,
      startLine,
      endLine,
      children: [],
      code: this.stripComments(source.slice(node.startIndex, node.endIndex)),
      unitType: IndexUnitType.FUNCTION,
      parentId: parentClass?.id,
      parent: parentClass,
    };
    if (parentClass) {
      parentClass.children = parentClass.children || [];
      parentClass.children.push(unit);
    }
    return unit;
  }

  private extractBlocks(
    bodyNode: Parser.SyntaxNode,
    source: string,
    file: string,
    parentFunction: IndexUnit
  ): IndexUnit[] {
    const blocks: IndexUnit[] = [];

    const visit = (n: Parser.SyntaxNode) => {
      if (this.isBlockNode(n)) {
        const startLine = n.startPosition.row;
        const endLine = n.endPosition.row;
        const lineCount = endLine - startLine;
        if (this.shouldSkip(IndexUnitType.BLOCK, parentFunction.name, lineCount)) {
          return;
        }
        if (lineCount >= indexConfig.blockMinLines) {
          const id = this.buildId(IndexUnitType.BLOCK, file, parentFunction.name, startLine, endLine);
          const blockUnit: IndexUnit = {
            id,
            name: parentFunction.name,
            filePath: file,
            startLine,
            endLine,
            code: this.stripComments(source.slice(n.startIndex, n.endIndex)),
            unitType: IndexUnitType.BLOCK,
            parentId: parentFunction.id,
            parent: parentFunction,
          };
          const contextLength = this.config?.contextLength ?? 2048;
          const splitBlocks = this.textSplitBlockIfOverContextLimit(blockUnit, contextLength);
          parentFunction.children = parentFunction.children || [];
          parentFunction.children.push(...splitBlocks);
          blocks.push(...splitBlocks);
        }
      }

      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (child) visit(child);
      }
    };

    visit(bodyNode);
    return blocks;
  }

  private stripClassBody(node: Parser.SyntaxNode, source: string): string {
    const classStart = node.startIndex;
    let code = source.slice(classStart, node.endIndex);

    const methodBodies: Array<{ start: number; end: number }> = [];
    const candidates = this.getMethodBodiesForClass(node);

    for (const body of candidates) {
      methodBodies.push({ start: body.startIndex - classStart, end: body.endIndex - classStart });
    }

    methodBodies.sort((a, b) => b.start - a.start);
    for (const body of methodBodies) {
      code = code.slice(0, body.start) + " { }" + code.slice(body.end);
    }

    return code;
  }

  private buildId(type: IndexUnitType, filePath: string, name: string, startLine: number, endLine: number): string {
    const pathKey = this.pathKeyForId(filePath);
    const scopedName = this.scopeNameWithPath(type, pathKey, name);
    return `${type}:${scopedName}:${startLine}-${endLine}`;
  }

  private pathKeyForId(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    return normalized.replace(/\.[^./]+$/, "");
  }

  private scopeNameWithPath(type: IndexUnitType, pathKey: string, name: string): string {
    if (type === IndexUnitType.CLASS) {
      return pathKey;
    }

    const classLeaf = pathKey.split("/").pop() ?? pathKey;
    if (name === classLeaf) {
      return pathKey;
    }
    if (name.startsWith(`${classLeaf}.`)) {
      return `${pathKey}${name.slice(classLeaf.length)}`;
    }

    return `${pathKey}.${name}`;
  }

  private extractArity(code: string): number {
    const match = code.match(/^[^{]*?\(([^)]*)\)/s);
    if (!match) return 0;
    const params = match[1]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    return params.length;
  }

  private normalizeCode(code: string): string {
    const withoutBlockComments = code.replace(/\/\*[\s\S]*?\*\//g, "");
    const withoutLineComments = withoutBlockComments.replace(/\/\/[^\n\r]*/g, "");
    return withoutLineComments.replace(/\s+/g, "");
  }

  private stripComments(code: string): string {
    const withoutBlockComments = code.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n\r]/g, ""));
    return withoutBlockComments.replace(/\/\/[^\n\r]*/g, "");
  }

  private removeDuplicates(units: IndexUnit[]): IndexUnit[] | PromiseLike<IndexUnit[]> {
    return Array.from(new Map(units.map(u => [u.id, u])).values());
  }

  /** Splits a block unit's code into chunks if it exceeds the context length limit. */
  private textSplitBlockIfOverContextLimit(unit: IndexUnit, contextLength: number): IndexUnit[] {
    if (unit.code.length <= contextLength) return [unit];

    const chunks: IndexUnit[] = [];
    let chunkIndex = 0;
    for (let i = 0; i < unit.code.length; i += contextLength) {
      chunks.push({
        ...unit,
        id: `${unit.id}:chunk${chunkIndex}`,
        code: unit.code.slice(i, i + contextLength),
      });
      chunkIndex++;
    }
    return chunks;
  }
}

