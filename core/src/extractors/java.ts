import Java from "tree-sitter-java";
import { BaseTreeSitterExtractor } from "./baseTreeSitter";
import { TrivialityRules } from "./triviality";
import type Parser from "tree-sitter";
import { IndexUnit } from "../types";

// Java-focused triviality rules. Arrow bodies do not apply; keep heuristics narrow.
const javaTrivialityRules: TrivialityRules = {
  maxLines: 3,
  getterPattern: /^(get|is)[A-Z]/,
  setterPattern: /^set[A-Z]/,
  allowArrowExpressionBodies: false,
  allowReturnOnly: true,
  allowSimpleAssignment: true,
};

export class JavaExtractor extends BaseTreeSitterExtractor {
  constructor() {
    super({
      id: "java",
      exts: [".java"],
      language: Java,
      trivialityRules: javaTrivialityRules,
      isClassNode: (node) => node.type === "class_declaration",
      getClassName: (node, source) => {
        const nameNode = node.childForFieldName?.("name");
        return nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : null;
      },
      isFunctionNode: (node) => node.type === "method_declaration" || node.type === "constructor_declaration",
      getFunctionName: (node, source, parentClass?: IndexUnit) => {
        const nameNode = node.childForFieldName?.("name");
        const nameText = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : "<anonymous>";
        return parentClass ? `${parentClass.name}.${nameText}` : nameText;
      },
      getFunctionBody: (node) => node.childForFieldName?.("body") ?? null,
      isBlockNode: (node) => node.type === "block",
      isCallNode: (node) => node.type === "method_invocation",
      getCallName: (node, source) => {
        const nameNode = node.childForFieldName("name");
        return nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : null;
      },
      getMethodBodiesForClass: (node: Parser.SyntaxNode) => {
        const bodies: Parser.SyntaxNode[] = [];
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (!child) continue;
          if (child.type === "method_declaration" || child.type === "constructor_declaration") {
            const body = child.childForFieldName?.("body");
            if (body) bodies.push(body);
          }
        }
        return bodies;
      },
    });
  }
}
