import Parser from "tree-sitter";
import { IndexUnit, IndexUnitType } from "../types";
import { LanguageExtractor } from "./LanguageExtractor";
import { DryConfig } from "../config/dryconfig";
import { TrivialityRules, isTrivialFunctionUnit } from "./triviality";
import { indexConfig } from "../config/indexConfig";

interface ParsedFile {
  tree: Parser.Tree;
  source: string;
  functions: Map<string, Parser.SyntaxNode>;
}

export interface TreeSitterExtractorSpec {
  id: string;
  exts: string[];
  language: any;
  trivialityRules: TrivialityRules;
  isClassNode(node: Parser.SyntaxNode): boolean;
  getClassName(node: Parser.SyntaxNode, source: string): string | null;
  isFunctionNode(node: Parser.SyntaxNode): boolean;
  getFunctionName(node: Parser.SyntaxNode, source: string, parentClass?: IndexUnit): string | null;
  getFunctionBody(node: Parser.SyntaxNode): Parser.SyntaxNode | null;
  isBlockNode(node: Parser.SyntaxNode): boolean;
  isCallNode(node: Parser.SyntaxNode): boolean;
  getCallName(node: Parser.SyntaxNode, source: string): string | null;
  getMethodBodiesForClass?(node: Parser.SyntaxNode): Parser.SyntaxNode[];
}

export abstract class BaseTreeSitterExtractor implements LanguageExtractor {
  readonly id: string;
  readonly exts: string[];
  private parser: Parser;
  private readonly spec: TreeSitterExtractorSpec;
  private readonly parsedFiles: Map<string, ParsedFile> = new Map();

  protected constructor(spec: TreeSitterExtractorSpec) {
    this.id = spec.id;
    this.exts = spec.exts;
    this.spec = spec;

    this.parser = new Parser();
    this.parser.setLanguage(spec.language);
  }

  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return this.exts.some((ext) => lower.endsWith(ext));
  }

  async extractFromText(file: string, source: string, config: DryConfig): Promise<IndexUnit[]> {
    if (!source.trim()) return [];

    const tree = this.parser.parse(source);
    const units: IndexUnit[] = [];
    const functionNodes = new Map<string, Parser.SyntaxNode>();

    const visit = (node: Parser.SyntaxNode, currentClass?: IndexUnit) => {
      if (this.spec.isClassNode(node)) {
        const className = this.spec.getClassName(node, source) || "<anonymous>";
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const classLength = endLine - startLine + 1;
        const skipClass = config.maxLines && classLength > config.maxLines;
        const classId = this.buildId(IndexUnitType.CLASS, className, startLine, endLine);
        const classUnit: IndexUnit = {
          id: classId,
          name: className,
          filePath: file,
          startLine,
          endLine,
          code: this.stripClassBody(node, source),
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

      if (this.spec.isFunctionNode(node)) {
        const fnUnit = this.buildFunctionUnit(node, source, file, currentClass);
        const fnLength = fnUnit.endLine - fnUnit.startLine + 1;
        const bodyNode = this.spec.getFunctionBody(node);
        const skipFunction = (config.maxLines && fnLength > config.maxLines) ||
          isTrivialFunctionUnit(fnUnit, this.spec.trivialityRules, {
            bodyNode,
            isArrowExpression: node.type === "arrow_function",
          });

        if (skipFunction) {
          return;
        }

        units.push(fnUnit);
        functionNodes.set(fnUnit.id, node);

        if (bodyNode) {
          const blocks = this.extractBlocks(bodyNode, source, file, fnUnit, config);
          units.push(...blocks);
        }
      }

      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) visit(child, currentClass);
      }
    };

    visit(tree.rootNode);

    this.parsedFiles.set(file, { tree, source, functions: functionNodes });

    return units;
  }

  extractCallsFromUnit(filePath: string, unitId: string): string[] {
    const parsed = this.parsedFiles.get(filePath);
    if (!parsed) return [];

    const functionNode = parsed.functions.get(unitId);
    if (!functionNode) return [];

    return this.extractCallsFromNode(functionNode, parsed.source);
  }

  private extractCallsFromNode(node: Parser.SyntaxNode, source: string): string[] {
    const calls: string[] = [];

    const visit = (n: Parser.SyntaxNode) => {
      if (this.spec.isCallNode(n)) {
        const callName = this.spec.getCallName(n, source);
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

  private buildFunctionUnit(
    node: Parser.SyntaxNode,
    source: string,
    file: string,
    parentClass?: IndexUnit
  ): IndexUnit {
    const name = this.spec.getFunctionName(node, source, parentClass) || "<anonymous>";
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const id = this.buildId(IndexUnitType.FUNCTION, name, startLine, endLine);
    const unit: IndexUnit = {
      id,
      name,
      filePath: file,
      startLine,
      endLine,
      code: source.slice(node.startIndex, node.endIndex),
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
    parentFunction: IndexUnit,
    config: DryConfig
  ): IndexUnit[] {
    const blocks: IndexUnit[] = [];

    const visit = (n: Parser.SyntaxNode) => {
      if (this.spec.isBlockNode(n)) {
        const startLine = n.startPosition.row + 1;
        const endLine = n.endPosition.row + 1;
        const lineCount = endLine - startLine + 1;
        const withinLimits = !config.maxBlockLines || lineCount <= config.maxBlockLines;
        if (lineCount >= indexConfig.blockMinLines && withinLimits) {
          const id = this.buildId(IndexUnitType.BLOCK, parentFunction.name, startLine, endLine);
          const blockUnit: IndexUnit = {
            id,
            name: parentFunction.name,
            filePath: file,
            startLine,
            endLine,
            code: source.slice(n.startIndex, n.endIndex),
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
    const candidates = this.spec.getMethodBodiesForClass
      ? this.spec.getMethodBodiesForClass(node)
      : this.findMethodBodies(node);

    for (const body of candidates) {
      methodBodies.push({ start: body.startIndex - classStart, end: body.endIndex - classStart });
    }

    methodBodies.sort((a, b) => b.start - a.start);
    for (const body of methodBodies) {
      code = code.slice(0, body.start) + " { }" + code.slice(body.end);
    }

    return code;
  }

  private findMethodBodies(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const bodies: Parser.SyntaxNode[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;
      const body = this.spec.getFunctionBody(child);
      if (body) {
        bodies.push(body);
      }
    }
    return bodies;
  }

  private buildId(type: IndexUnitType, name: string, startLine: number, endLine: number): string {
    return `${type}:${name}:${startLine}-${endLine}`;
  }
}