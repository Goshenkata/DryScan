import crypto from "node:crypto";
import debug from "debug";
import { minimatch } from "minimatch";
import { LanguageExtractor } from "../extractors/LanguageExtractor";
import { IndexUnitExtractor } from "../IndexUnitExtractor";
import { IndexUnit, IndexUnitType } from "../types";
import { BLOCK_HASH_ALGO } from "../const";

const log = debug("DryScan:pairs");

type UnitLike = Pick<IndexUnit, "unitType" | "filePath" | "name" | "code">;

export interface ParsedPairKey {
  type: IndexUnitType;
  left: string;
  right: string;
  key: string;
}

/**
 * Service for building and parsing pair keys with extractor-aware labeling.
 */
export class PairingService {
  constructor(private readonly indexUnitExtractor: IndexUnitExtractor) {}

  /**
   * Creates a stable, order-independent key for two units of the same type.
   * Returns null when units differ in type so callers can skip invalid pairs.
   */
  pairKeyForUnits(left: UnitLike, right: UnitLike): string | null {
    if (left.unitType !== right.unitType) {
      log("Skipping pair with mismatched types: %s vs %s", left.unitType, right.unitType);
      return null;
    }
    const type = left.unitType;
    const leftLabel = this.unitLabel(left);
    const rightLabel = this.unitLabel(right);
    const [a, b] = [leftLabel, rightLabel].sort();
    return `${type}|${a}|${b}`;
  }

  /**
   * Parses a raw pair key into its components, returning null for malformed values.
   * Sorting is applied so callers can compare pairs without worrying about order.
   */
  parsePairKey(value: string): ParsedPairKey | null {
    const parts = value.split("|");
    if (parts.length !== 3) {
      log("Invalid pair key format: %s", value);
      return null;
    }
    const [typeRaw, leftRaw, rightRaw] = parts;
    const type = this.stringToUnitType(typeRaw);
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
  pairKeyMatches(actual: ParsedPairKey, pattern: ParsedPairKey): boolean {
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

  /**
   * Derives a reversible, extractor-aware label for a unit.
   * Extractors may override; fallback uses a fixed format per unit type.
   */
  unitLabel(unit: UnitLike): string {
    const extractor = this.findExtractor(unit.filePath);
    const customLabel = extractor?.unitLabel?.(unit as IndexUnit);
    if (customLabel) return customLabel;

    switch (unit.unitType) {
      case IndexUnitType.CLASS:
        return unit.filePath;
      case IndexUnitType.FUNCTION:
        return this.canonicalFunctionSignature(unit);
      case IndexUnitType.BLOCK:
        return this.normalizedBlockHash(unit);
      default:
        return unit.name;
    }
  }

  private findExtractor(filePath: string): LanguageExtractor | undefined {
    return this.indexUnitExtractor.extractors.find((ex) => ex.supports(filePath));
  }

  private canonicalFunctionSignature(unit: UnitLike): string {
    const arity = this.extractArity(unit.code);
    return `${unit.name}(arity:${arity})`;
  }

  /**
   * Normalizes block code (strips comments/whitespace) and hashes it for pair matching.
   */
  private normalizedBlockHash(unit: UnitLike): string {
    const normalized = this.normalizeCode(unit.code);
    return crypto.createHash(BLOCK_HASH_ALGO).update(normalized).digest("hex");
  }

  private stringToUnitType(value: string): IndexUnitType | null {
    if (value === IndexUnitType.CLASS) return IndexUnitType.CLASS;
    if (value === IndexUnitType.FUNCTION) return IndexUnitType.FUNCTION;
    if (value === IndexUnitType.BLOCK) return IndexUnitType.BLOCK;
    return null;
  }

  private extractArity(code: string): number {
    const match = code.match(/^[^{]*?\(([^)]*)\)/s);
    if (!match) return 0;
    const params = match[1]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    return params.length;
  }

  private normalizeCode(code: string): string {
    const withoutBlockComments = code.replace(/\/\*[\s\S]*?\*\//g, "");
    const withoutLineComments = withoutBlockComments.replace(/\/\/[^\n\r]*/g, "");
    return withoutLineComments.replace(/\s+/g, "");
  }
}
