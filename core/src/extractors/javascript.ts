import JavaScript from "tree-sitter-javascript";
import type Parser from "tree-sitter";
import { BaseTreeSitterExtractor } from "./baseTreeSitter";
import { TrivialityRules } from "./triviality";
import { IndexUnit } from "../types";

// JS/TS-focused triviality rules. We allow arrow-expression bodies and simple return-only getters/setters.
const jsTrivialityRules: TrivialityRules = {
  maxLines: 3,
  getterPattern: /^(get|is)[A-Z]/,
  setterPattern: /^set[A-Z]/,
  allowArrowExpressionBodies: true,
  allowReturnOnly: true,
  allowSimpleAssignment: true,
};

export class JavaScriptExtractor extends BaseTreeSitterExtractor {
  constructor() {
    super({
      id: "javascript",
      exts: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"],
      language: JavaScript,
      trivialityRules: jsTrivialityRules,
      isClassNode: (node) => node.type === "class_declaration" || node.type === "class",
      getClassName: (node, source) => {
        const name = getName(node, source);
        return name ?? "<anonymous>";
      },
      isFunctionNode: (node) =>
        node.type === "function_declaration" ||
        node.type === "method_definition" ||
        node.type === "function" ||
        node.type === "arrow_function",
      getFunctionName: (node, source, parentClass?: IndexUnit) => {
        const name = getName(node, source) || "<anonymous>";
        return parentClass ? `${parentClass.name}.${name}` : name;
      },
      getFunctionBody: (node) => {
        const body = node.childForFieldName?.("body");
        if (body) return body;
        if (node.type === "arrow_function" && node.namedChildCount > 0) {
          return node.namedChild(node.namedChildCount - 1);
        }
        return null;
      },
      isBlockNode: (node) => node.type === "statement_block" || node.type === "block",
      isCallNode: (node) => node.type === "call_expression",
      getCallName: (node, source) => {
        const callee = node.childForFieldName("function");
        if (!callee) return null;
        return getCallName(callee, source);
      },
      getMethodBodiesForClass: (node: Parser.SyntaxNode) => {
        const bodies: Parser.SyntaxNode[] = [];
        for (let i = 0; i < node.namedChildCount; i++) {
          const child = node.namedChild(i);
          if (!child) continue;
          if (child.type === "method_definition") {
            const body = child.childForFieldName?.("body");
            if (body) bodies.push(body);
          }
        }
        return bodies;
      },
    });
  }
}

function getCallName(node: Parser.SyntaxNode, source: string): string | null {
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

function getName(node: Parser.SyntaxNode, source: string): string | null {
  const ident = node.childForFieldName?.("name");
  if (ident) return source.slice(ident.startIndex, ident.endIndex);

  const prop = node.child(0);
  if (prop && (prop.type.includes("identifier") || prop.type === "property_identifier")) {
    return source.slice(prop.startIndex, prop.endIndex);
  }
  return null;
}
