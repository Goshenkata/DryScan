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

function simpleName(name: string): string {
  const parts = name.split(".");
  return parts[parts.length - 1];
}

/**
 * Generic triviality check that can be tuned per language via TrivialityRules.
 * Keep heuristics narrow to avoid suppressing meaningful small methods.
 */
export function isTrivialFunctionUnit(
  unit: Pick<IndexUnit, "name" | "code">,
  rules: TrivialityRules
): boolean {
  const name = simpleName(unit.name);
  const code = unit.code.trim();
  if (!code) return false;

  // Normalize whitespace to simplify regexes.
  const normalized = code.replace(/\s+/g, " ").trim();

  // Extract method body when braces exist so modifiers/signatures do not block detection.
  const bodyMatch = code.match(/\{([\s\S]*)\}/);
  const body = bodyMatch ? bodyMatch[1] : code;
  const bodyNormalized = body.replace(/\s+/g, " ").trim();
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length > rules.maxLines) return false;

  const looksLikeGetter = rules.getterPattern?.test(name) ?? false;
  const looksLikeSetter = rules.setterPattern?.test(name) ?? false;

  // Getter: return a single identifier/field.
  if (rules.allowReturnOnly && /^(return\s+[A-Za-z_][\w\.]*\s*;?\s*\}?$)/.test(bodyNormalized)) {
    if (looksLikeGetter || lines.length <= 2) return true;
  }
  // Getter fallback: inline body inside braces on one line.
  if (
    rules.allowReturnOnly &&
    /\{\s*return\s+[A-Za-z_][\w\.]*\s*;?\s*\}/.test(normalized) &&
    (looksLikeGetter || lines.length <= 2)
  ) {
    return true;
  }

  // Setter: single assignment of parameter to field.
  if (
    rules.allowSimpleAssignment &&
    /^[A-Za-z_][\w\.]*\s*=\s*[A-Za-z_][\w\.]*\s*;?\s*\}?$/.test(bodyNormalized) &&
    (looksLikeSetter || lines.length <= 2)
  ) {
    return true;
  }

  // Arrow-expression body returning identifier (JS/TS).
  if (
    rules.allowArrowExpressionBodies &&
    /^\(?[A-Za-z0-9_,\s]*\)?\s*=>\s*[A-Za-z_][\w\.]*\s*;?$/.test(normalized)
  ) {
    return true;
  }

  return false;
}
