import { IndexUnit } from "../types";

export interface LanguageExtractor {
  readonly id: string;
  readonly exts: string[];
  supports(filePath: string): boolean;
  extractFromText(filePath: string, source: string): Promise<IndexUnit[]>;
  unitLabel(unit: IndexUnit): string | null;
}
