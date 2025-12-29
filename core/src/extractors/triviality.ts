import type Parser from "tree-sitter";
import { IndexUnit } from "../types";

// Language-specific knobs so each extractor can tune triviality without changing shared logic.
export interface TrivialityRules {
  maxLines: number; // Upper bound on lines to consider trivial
  getterPattern?: RegExp; // e.g., /^get[A-Z]/ or /^is[A-Z]/
  setterPattern?: RegExp; // e.g., /^set[A-Z]/
  allowArrowExpressionBodies?: boolean; // JS/TS arrow expression single-value bodies
  allowReturnOnly?: boolean; // Return single identifier/field
  allowSimpleAssignment?: boolean; // Single assignment like this.x = x;
}

export interface TrivialityContext {
  bodyNode?: Parser.SyntaxNode | null;
  isArrowExpression?: boolean;
}

function simpleName(name: string): string {
  const parts = name.split(".");
  return parts[parts.length - 1];
}

/**
 * Generic triviality check driven by AST structure (statement shapes), avoiding regex on raw code.
 */
export function isTrivialFunctionUnit(
  unit: Pick<IndexUnit, "name" | "code">,
  rules: TrivialityRules,
  ctx: TrivialityContext = {}
): boolean {
  const name = simpleName(unit.name);

  const looksLikeGetter = rules.getterPattern?.test(name) ?? false;
  const looksLikeSetter = rules.setterPattern?.test(name) ?? false;

  if (ctx.isArrowExpression && rules.allowArrowExpressionBodies) {
    return true;
  }

  if (!ctx.bodyNode) {
    return false;
  }

  const statements = collectStatements(ctx.bodyNode);
  if (statements.length === 0 || statements.length > rules.maxLines) return false;

  if (rules.allowReturnOnly && isSimpleReturn(statements[0])) {
    return looksLikeGetter || statements.length <= 2;
  }

  if (rules.allowSimpleAssignment && isSimpleAssignment(statements[0])) {
    return looksLikeSetter || statements.length <= 2;
  }

  return false;
}

function collectStatements(body: Parser.SyntaxNode): Parser.SyntaxNode[] {
  if (body.type.includes("block")) {
    return body.namedChildren.filter(Boolean);
  }
  return [body];
}

function isIdentifierLike(node: Parser.SyntaxNode | null | undefined): boolean {
  if (!node) return false;
  return node.type === "identifier" || node.type === "field_access" || node.type === "member_expression";
}

function isSimpleReturn(node: Parser.SyntaxNode): boolean {
  if (node.type !== "return_statement") return false;
  const target = node.namedChildCount > 0 ? node.namedChild(0) : null;
  return isIdentifierLike(target);
}

function isSimpleAssignment(node: Parser.SyntaxNode): boolean {
  if (node.type !== "expression_statement") return false;
  const expression = node.namedChild(0);
  if (!expression) return false;
  if (expression.type !== "assignment_expression") return false;
  const left = expression.namedChild(0);
  const right = expression.namedChild(1);
  return isIdentifierLike(left) && isIdentifierLike(right);
}
