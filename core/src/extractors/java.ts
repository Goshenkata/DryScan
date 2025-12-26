import Parser from "tree-sitter";
// @ts-ignore - old cjs typings
import Java from "tree-sitter-java";
import { FunctionInfo } from "../types";
import { LanguageExtractor } from "./LanguageExtractor.js";

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

  async extractFromText(file: string, source: string): Promise<FunctionInfo[]> {
    const tree = this.parser.parse(source);
    const functions: FunctionInfo[] = [];
    const functionNodes = new Map<string, Parser.SyntaxNode>();

    const visit = (node: Parser.SyntaxNode, className?: string) => {
      if (node.type === "class_declaration") {
        const nameNode = node.childForFieldName?.("name");
        const className = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : undefined;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) visit(child, className);
        }
        return;
      }
      if (node.type === "method_declaration" || node.type === "constructor_declaration") {
        const nameNode = node.childForFieldName?.("name");
        const nameText = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : "<anonymous>";
        const name = className ? `${className}.${nameText}` : nameText;
        const { startPosition, endPosition } = node;
        const startLine = startPosition.row + 1;
        const endLine = endPosition.row + 1;
        const code = source.slice(node.startIndex, node.endIndex);
        const id = `${name}:${startLine}-${endLine}`;
        
        functions.push({ id, name, filePath: file, startLine, endLine, code });
        functionNodes.set(id, node);
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) visit(child, className);
      }
    };

    visit(tree.rootNode);
    
    this.parsedFiles.set(file, { tree, source, functions: functionNodes });
    
    return functions;
  }

  /**
   * Extracts method invocation names from a previously parsed function.
   * Uses cached AST to avoid re-parsing.
   */
  extractCallsFromFunction(filePath: string, functionId: string): string[] {
    const parsed = this.parsedFiles.get(filePath);
    if (!parsed) return [];

    const functionNode = parsed.functions.get(functionId);
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
}
