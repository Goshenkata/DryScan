import Parser from "tree-sitter";
// @ts-ignore - old cjs typings
import JavaScript from "tree-sitter-javascript";
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

  async extractFromText(file: string, source: string): Promise<FunctionInfo[]> {
    const tree = this.parser.parse(source);
    const functions: FunctionInfo[] = [];
    const functionNodes = new Map<string, Parser.SyntaxNode>();

    const visit = (node: Parser.SyntaxNode) => {
      const type = node.type;
      if (
        type === "function_declaration" ||
        type === "method_definition" ||
        type === "function" ||
        type === "arrow_function"
      ) {
        const name = this.getName(node, source) || "<anonymous>";
        const { startPosition, endPosition } = node;
        const startLine = startPosition.row + 1;
        const endLine = endPosition.row + 1;
        const code = source.slice(node.startIndex, node.endIndex);
        const id = `${name}:${startLine}-${endLine}`;
        
        functions.push({
          id,
          name,
          filePath: file,
          startLine,
          endLine,
          code
        });
        
        functionNodes.set(id, node);
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) visit(child);
      }
    };

    visit(tree.rootNode);
    
    this.parsedFiles.set(file, { tree, source, functions: functionNodes });
    
    return functions;
  }

  /**
   * Extracts function call names from a previously parsed function.
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
