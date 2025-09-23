import Parser from "tree-sitter";
// @ts-ignore - old cjs typings
import Python from "tree-sitter-python";
import { FunctionInfo } from "../types";
import { LanguageExtractor } from "./LanguageExtractor";

export class PythonExtractor implements LanguageExtractor {
  readonly id = "python";
  readonly exts = [".py"];
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Python);
  }

  supports(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return this.exts.some(ext => lower.endsWith(ext));
  }

  async extractFromText(file: string, source: string): Promise<FunctionInfo[]> {
    const tree = this.parser.parse(source);
    const functions: FunctionInfo[] = [];

    const visit = (node: Parser.SyntaxNode, className?: string) => {
      if (node.type === "function_definition") {
        const nameNode = node.childForFieldName?.("name");
        const nameText = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : "<anonymous>";
        const name = className ? `${className}.${nameText}` : nameText;
        const { startPosition, endPosition } = node;
        const startLine = startPosition.row + 1;
        const endLine = endPosition.row + 1;
        const code = source.slice(node.startIndex, node.endIndex);
        functions.push({ id: `${file}:${startLine}-${endLine}`, name, fullPath: file, startLine, endLine, code });
      }
      if (node.type === "class_definition") {
        const classNameNode = node.childForFieldName?.("name");
        const cls = classNameNode ? source.slice(classNameNode.startIndex, classNameNode.endIndex) : undefined;
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (child) visit(child, cls);
        }
        return;
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
