import Parser from "tree-sitter";
// @ts-ignore - old cjs typings
import JavaScript from "tree-sitter-javascript";
import { FunctionInfo } from "../types";
import { LanguageExtractor } from "./LanguageExtractor";

export class JavaScriptExtractor implements LanguageExtractor {
  readonly id = "javascript";
  readonly exts = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];
  private parser: Parser;

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

    const visit = (node: Parser.SyntaxNode) => {
      const type = node.type;
      if (
        type === "function_declaration" ||
        type === "method_definition" ||
        type === "function" || // function expressions
        type === "arrow_function"
      ) {
        const name = this.getName(node, source) || "<anonymous>";
        const { startPosition, endPosition } = node;
        const startLine = startPosition.row + 1;
        const endLine = endPosition.row + 1;
        const code = source.slice(node.startIndex, node.endIndex);
        functions.push({
          id: `${file}:${startLine}-${endLine}`,
          name,
          fullPath: file,
          startLine,
          endLine,
          code,
        });
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) visit(child);
      }
    };

    visit(tree.rootNode);
    return functions;
  }

  private getName(node: Parser.SyntaxNode, source: string): string | null {
    // function_declaration -> child identifier
    const ident = node.childForFieldName?.("name");
    if (ident) return source.slice(ident.startIndex, ident.endIndex);

    // method_definition -> property_identifier
    const prop = node.child(0);
    if (prop && (prop.type.includes("identifier") || prop.type === "property_identifier")) {
      return source.slice(prop.startIndex, prop.endIndex);
    }
    return null;
  }
}
