import { FunctionInfo } from "../types";

export interface LanguageExtractor {
  readonly id: string;
  readonly exts: string[];
  supports(filePath: string): boolean;
  extractFromText(filePath: string, source: string): Promise<FunctionInfo[]>;
}
