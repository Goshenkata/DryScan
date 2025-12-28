import Parser from "tree-sitter";
// @ts-ignore - old cjs typings
import Java from "tree-sitter-java";
import { IndexUnit, IndexUnitType } from "../types";
import { LanguageExtractor } from "./LanguageExtractor";
import { indexConfig } from "../config/indexConfig";

/**
 * Cached parse result to avoid re-parsing during call extraction.
 */
interface ParsedFile {
  tree: Parser.Tree;
  source: string;
  functions: Map<string, Parser.SyntaxNode>; // Map function ID to AST node
}

export class JavaExtractor implements LanguageExtractor {
  readonly id = "java";
  readonly exts = [".java"];
  private parser: Parser;
  /** Cache of parsed files to avoid re-parsing for call extraction */
  private parsedFiles: Map<string, ParsedFile> = new Map();

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Java);
  }

  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return this.exts.some(ext => lower.endsWith(ext));
  }

  async extractFromText(file: string, source: string): Promise<IndexUnit[]> {
    if (!source.trim()) return [];

    const tree = this.parser.parse(source);
    const units: IndexUnit[] = [];
    const functionNodes = new Map<string, Parser.SyntaxNode>();

    const visit = (node: Parser.SyntaxNode, currentClass?: IndexUnit) => {
      if (node.type === "class_declaration") {
        const nameNode = node.childForFieldName?.("name");
        const className = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : "<anonymous>";
        const { startPosition, endPosition } = node;
        const startLine = startPosition.row + 1;
        const endLine = endPosition.row + 1;
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
        units.push(classUnit);

        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) visit(child, classUnit);
        }
        return;
      }

      if (node.type === "method_declaration" || node.type === "constructor_declaration") {
        const functionUnit = this.buildFunctionUnit(node, source, file, currentClass);
        units.push(functionUnit);
        functionNodes.set(functionUnit.id, node);

        // Extract meaningful blocks inside the method body
        const bodyNode = node.childForFieldName?.("body");
        if (bodyNode) {
          const blocks = this.extractBlocks(bodyNode, source, file, functionUnit);
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

  /**
   * Extracts method invocation names from a previously parsed function.
   * Uses cached AST to avoid re-parsing.
   */
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
      if (n.type === "method_invocation") {
        const nameNode = n.childForFieldName("name");
        if (nameNode) {
          const callName = source.slice(nameNode.startIndex, nameNode.endIndex);
          calls.push(callName);
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i);
        if (child) visit(child);
      }
    };

    visit(node);
    return calls;
  }

  private buildId(type: IndexUnitType, name: string, startLine: number, endLine: number): string {
    return `${type}:${name}:${startLine}-${endLine}`;
  }

  private buildFunctionUnit(
    node: Parser.SyntaxNode,
    source: string,
    file: string,
    parentClass?: IndexUnit
  ): IndexUnit {
    const nameNode = node.childForFieldName?.("name");
    const nameText = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : "<anonymous>";
    const qualifiedName = parentClass ? `${parentClass.name}.${nameText}` : nameText;
    const { startPosition, endPosition } = node;
    const startLine = startPosition.row + 1;
    const endLine = endPosition.row + 1;
    const id = this.buildId(IndexUnitType.FUNCTION, qualifiedName, startLine, endLine);
    const unit: IndexUnit = {
      id,
      name: qualifiedName,
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
    parentFunction: IndexUnit
  ): IndexUnit[] {
    const blocks: IndexUnit[] = [];

    const visit = (n: Parser.SyntaxNode) => {
      if (n.type === "block") {
        const startLine = n.startPosition.row + 1;
        const endLine = n.endPosition.row + 1;
        const lineCount = endLine - startLine + 1;
        if (lineCount >= indexConfig.blockMinLines) {
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
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (!child) continue;
      if (child.type === "method_declaration" || child.type === "constructor_declaration") {
        const body = child.childForFieldName?.("body");
        if (body) {
          methodBodies.push({ start: body.startIndex - classStart, end: body.endIndex - classStart });
        }
      }
    }

    methodBodies.sort((a, b) => b.start - a.start);
    for (const body of methodBodies) {
      code = code.slice(0, body.start) + " { }" + code.slice(body.end);
    }

    return code;
  }
}
