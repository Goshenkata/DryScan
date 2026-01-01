import crypto from "node:crypto";
import Parser from "tree-sitter";
import Java from "tree-sitter-java";
import { LanguageExtractor } from "./LanguageExtractor";
import { IndexUnit, IndexUnitType } from "../types";
import { indexConfig } from "../config/indexConfig";
import { DryConfig } from "../types";
import { configStore } from "../config/configStore";
import { BLOCK_HASH_ALGO } from "../const";

interface ParsedFile {
  tree: Parser.Tree;
  source: string;
  functions: Map<string, Parser.SyntaxNode>;
}

export class JavaExtractor implements LanguageExtractor {
  readonly id = "java";
  readonly exts = [".java"];

  private parser: Parser;
  private readonly repoPath: string;
  private config?: DryConfig;
  private readonly parsedFiles: Map<string, ParsedFile> = new Map();

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

    const tree = this.parser.parse(source);
    const units: IndexUnit[] = [];
    const functionNodes = new Map<string, Parser.SyntaxNode>();

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
        const classId = this.buildId(IndexUnitType.CLASS, className, startLine, endLine);
        const code = this.stripAnnotations(this.stripClassBody(node, source));
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
        const skipFunction = this.shouldSkip(IndexUnitType.FUNCTION, fnUnit.name, fnLength);

        if (skipFunction) {
          return;
        }

        units.push(fnUnit);
        functionNodes.set(fnUnit.id, node);

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

    this.parsedFiles.set(fileRelPath, { tree, source, functions: functionNodes });

    return units;
  }

  extractCallsFromUnit(filePath: string, unitId: string): string[] {
    const parsed = this.parsedFiles.get(filePath);
    if (!parsed) return [];

    const functionNode = parsed.functions.get(unitId);
    if (!functionNode) return [];

    return this.extractCallsFromNode(functionNode, parsed.source);
  }

  unitLabel(unit: IndexUnit): string | null {
    if (unit.unitType === IndexUnitType.CLASS) return unit.filePath;
    if (unit.unitType === IndexUnitType.FUNCTION) return this.canonicalFunctionSignature(unit);
    if (unit.unitType === IndexUnitType.BLOCK) return this.normalizedBlockHash(unit);
    return unit.name;
  }

  private extractCallsFromNode(node: Parser.SyntaxNode, source: string): string[] {
    const calls: string[] = [];

    const visit = (n: Parser.SyntaxNode) => {
      if (this.isCallNode(n)) {
        const callName = this.getCallName(n, source);
        if (callName) calls.push(callName);
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (child) visit(child);
      }
    };

    visit(node);
    return calls;
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

  private isCallNode(node: Parser.SyntaxNode): boolean {
    return node.type === "method_invocation";
  }

  private getCallName(node: Parser.SyntaxNode, source: string): string | null {
    const nameNode = node.childForFieldName("name");
    return nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : null;
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

  private shouldSkip(unitType: IndexUnitType, name: string, lineCount: number): boolean {
    if (!this.config) {
      throw new Error("Config not loaded before skip evaluation");
    }
    const config = this.config;
    const minLines = unitType === IndexUnitType.BLOCK
      ? Math.max(indexConfig.blockMinLines, config.minBlockLines ?? 0)
      : config.minLines;
    const belowMin = minLines > 0 && lineCount < minLines;
    const trivial = unitType === IndexUnitType.FUNCTION && this.isTrivialFunction(name);
    return belowMin || trivial;
  }

  private isTrivialFunction(fullName: string): boolean {
    const simpleName = fullName.split(".").pop() || fullName;
    const isGetter = /^(get|is)[A-Z]/.test(simpleName);
    const isSetter = /^set[A-Z]/.test(simpleName);
    return isGetter || isSetter;
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
        if (!this.isTrivialFunction(fullName)) {
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

  private stripAnnotations(code: string): string {
    return code.replace(/@[\w.]+(?:\s*\([^)]*\))?/g, "");
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
    const id = this.buildId(IndexUnitType.FUNCTION, name, startLine, endLine);
      const unit: IndexUnit = {
      id,
      name,
      filePath: file,
      startLine,
      endLine,
        code: this.stripAnnotations(source.slice(node.startIndex, node.endIndex)),
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
          const id = this.buildId(IndexUnitType.BLOCK, parentFunction.name, startLine, endLine);
          const blockUnit: IndexUnit = {
            id,
            name: parentFunction.name,
            filePath: file,
            startLine,
            endLine,
            code: this.stripAnnotations(source.slice(n.startIndex, n.endIndex)),
            unitType: IndexUnitType.BLOCK,
            parentId: parentFunction.id,
            parent: parentFunction,
          };
          parentFunction.children = parentFunction.children || [];
          parentFunction.children.push(blockUnit);
          blocks.push(blockUnit);
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

  private buildId(type: IndexUnitType, name: string, startLine: number, endLine: number): string {
    return `${type}:${name}:${startLine}-${endLine}`;
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
}
