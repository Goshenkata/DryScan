import crypto from "node:crypto";
import debug from "debug";
import { minimatch } from "minimatch";
import { IndexUnit, IndexUnitType } from "./types";

const log = debug("DryScan:pairs");

type UnitLike = Pick<IndexUnit, "unitType" | "filePath" | "name" | "code">;

export interface ParsedPairKey {
  type: IndexUnitType;
  left: string;
  right: string;
  key: string;
}

/**
 * Creates a stable, order-independent key for two units of the same type.
 * Returns null when units differ in type so callers can skip invalid pairs.
 */
export function pairKeyForUnits(left: UnitLike, right: UnitLike): string | null {
  if (left.unitType !== right.unitType) {
    log("Skipping pair with mismatched types: %s vs %s", left.unitType, right.unitType);
    return null;
  }
  const type = left.unitType;
  const leftLabel = unitLabel(left);
  const rightLabel = unitLabel(right);
  const [a, b] = [leftLabel, rightLabel].sort();
  return `${type}|${a}|${b}`;
}

/**
 * Parses a raw pair key into its components, returning null for malformed values.
 * Sorting is applied so callers can compare pairs without worrying about order.
 */
export function parsePairKey(value: string): ParsedPairKey | null {
  const parts = value.split("|");
  if (parts.length !== 3) {
    log("Invalid pair key format: %s", value);
    return null;
  }
  const [typeRaw, leftRaw, rightRaw] = parts;
  const type = stringToUnitType(typeRaw);
  if (!type) {
    log("Unknown unit type in pair key: %s", typeRaw);
    return null;
  }
  const [left, right] = [leftRaw, rightRaw].sort();
  return { type, left, right, key: `${type}|${left}|${right}` };
}

/**
 * Checks whether an actual pair key satisfies a pattern, with glob matching for class paths.
 */
export function pairKeyMatches(actual: ParsedPairKey, pattern: ParsedPairKey): boolean {
  if (actual.type !== pattern.type) return false;
  if (actual.type === IndexUnitType.CLASS) {
    // Allow glob matching for class file paths.
    const forward =
      minimatch(actual.left, pattern.left, { dot: true }) &&
      minimatch(actual.right, pattern.right, { dot: true });
    const swapped =
      minimatch(actual.left, pattern.right, { dot: true }) &&
      minimatch(actual.right, pattern.left, { dot: true });
    return forward || swapped;
  }

  // Functions and blocks use exact matching on canonical strings.
  return (
    (actual.left === pattern.left && actual.right === pattern.right) ||
    (actual.left === pattern.right && actual.right === pattern.left)
  );
}

export function canonicalFunctionSignature(unit: UnitLike): string {
  const arity = extractArity(unit.code);
  return `${unit.name}(arity:${arity})`;
}

/**
 * Normalizes block code (strips comments/whitespace) and hashes it for pair matching.
 */
export function normalizedBlockHash(unit: UnitLike): string {
  const normalized = normalizeCode(unit.code);
  return crypto.createHash("sha1").update(normalized).digest("hex");
}

function unitLabel(unit: UnitLike): string {
  switch (unit.unitType) {
    case IndexUnitType.CLASS:
      return unit.filePath;
    case IndexUnitType.FUNCTION:
      return canonicalFunctionSignature(unit);
    case IndexUnitType.BLOCK:
      return normalizedBlockHash(unit);
    default:
      return unit.name;
  }
}

function stringToUnitType(value: string): IndexUnitType | null {
  if (value === IndexUnitType.CLASS) return IndexUnitType.CLASS;
  if (value === IndexUnitType.FUNCTION) return IndexUnitType.FUNCTION;
  if (value === IndexUnitType.BLOCK) return IndexUnitType.BLOCK;
  return null;
}

function extractArity(code: string): number {
  const match = code.match(/^[^{]*?\(([^)]*)\)/s);
  if (!match) return 0;
  const params = match[1]
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return params.length;
}

function normalizeCode(code: string): string {
  const withoutBlockComments = code.replace(/\/\*[\s\S]*?\*\//g, "");
  const withoutLineComments = withoutBlockComments.replace(/\/\/[^\n\r]*/g, "");
  return withoutLineComments.replace(/\s+/g, "");
}
