import Parser from "tree-sitter";
// @ts-ignore - old cjs typings
import Java from "tree-sitter-java";
import { FunctionInfo } from "../types";
import { LanguageExtractor } from "./LanguageExtractor";

export class JavaExtractor implements LanguageExtractor {
  readonly id = "java";
  readonly exts = [".java"];
  private parser: Parser;

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
        functions.push({ id: `${file}:${startLine}-${endLine}`, name, fullPath: file, startLine, endLine, code });
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) visit(child, className);
      }
    };

    visit(tree.rootNode);
    return functions;
  }
}
