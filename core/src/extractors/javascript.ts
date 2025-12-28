import Parser from "tree-sitter";
// @ts-ignore - old cjs typings
import JavaScript from "tree-sitter-javascript";
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

export class JavaScriptExtractor implements LanguageExtractor {
  readonly id = "javascript";
  readonly exts = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];
  private parser: Parser;
  /** Cache of parsed files to avoid re-parsing for call extraction */
  private parsedFiles: Map<string, ParsedFile> = new Map();

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(JavaScript);
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
      const type = node.type;

      if (type === "class_declaration" || type === "class") {
        const name = this.getName(node, source) || "<anonymous>";
        const startLine = node.startPosition.row + 1;
        const endLine = node.endPosition.row + 1;
        const id = this.buildId(IndexUnitType.CLASS, name, startLine, endLine);
        const classUnit: IndexUnit = {
          id,
          name,
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

      if (
        type === "function_declaration" ||
        type === "method_definition" ||
        type === "function" ||
        type === "arrow_function"
      ) {
        const fnUnit = this.buildFunctionUnit(node, source, file, currentClass);
        units.push(fnUnit);
        functionNodes.set(fnUnit.id, node);

        const bodyNode = this.getBodyNode(node);
        if (bodyNode) {
          const blocks = this.extractBlocks(bodyNode, source, file, fnUnit);
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
   * Extracts function call names from a previously parsed function.
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
      if (n.type === "call_expression") {
        const callee = n.childForFieldName("function");
        if (callee) {
          const callName = this.getCallName(callee, source);
          if (callName) calls.push(callName);
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

  private getBodyNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    const body = node.childForFieldName?.("body");
    if (body) return body;
    // Arrow functions may have the body as the last child
    if (node.type === "arrow_function" && node.namedChildCount > 0) {
      return node.namedChild(node.namedChildCount - 1);
    }
    return null;
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
    const name = this.getName(node, source) || "<anonymous>";
    const qualifiedName = parentClass ? `${parentClass.name}.${name}` : name;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
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
      if (n.type === "statement_block" || n.type === "block") {
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
      if (child.type === "method_definition") {
        const body = this.getBodyNode(child);
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

  private getCallName(node: Parser.SyntaxNode, source: string): string | null {
    if (node.type === "identifier") {
      return source.slice(node.startIndex, node.endIndex);
    }
    if (node.type === "member_expression") {
      const property = node.childForFieldName("property");
      if (property) {
        return source.slice(property.startIndex, property.endIndex);
      }
    }
    return null;
  }

  private getName(node: Parser.SyntaxNode, source: string): string | null {
    const ident = node.childForFieldName?.("name");
    if (ident) return source.slice(ident.startIndex, ident.endIndex);

    const prop = node.child(0);
    if (prop && (prop.type.includes("identifier") || prop.type === "property_identifier")) {
      return source.slice(prop.startIndex, prop.endIndex);
    }
    return null;
  }
}
