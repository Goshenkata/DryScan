import { IndexUnit } from "../types";
import { DryConfig } from "../config/dryconfig";

export interface LanguageExtractor {
  readonly id: string;
  readonly exts: string[];
  supports(filePath: string): boolean;
  extractFromText(filePath: string, source: string, config: DryConfig): Promise<IndexUnit[]>;
  extractCallsFromUnit(filePath: string, unitId: string): string[];
}
