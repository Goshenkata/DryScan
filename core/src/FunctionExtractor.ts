import fs from "fs/promises";
import path from "path";
import { FunctionInfo } from "./types";
import { LanguageExtractor } from "./extractors/LanguageExtractor";
import { JavaScriptExtractor } from "./extractors/javascript";
import { PythonExtractor } from "./extractors/python";
import { JavaExtractor } from "./extractors/java";

export { LanguageExtractor } from "./extractors/LanguageExtractor";

export function defaultExtractors(): LanguageExtractor[] {
  return [new JavaScriptExtractor(), new PythonExtractor(), new JavaExtractor()];
}

export class FunctionExtractor {
  private readonly root: string;
  private readonly extractors: LanguageExtractor[];

  constructor(rootPath: string, extractors: LanguageExtractor[] = defaultExtractors()) {
    this.root = rootPath;
    this.extractors = extractors;
  }

  async scan(targetPath: string): Promise<FunctionInfo[]> {
    const fullPath = path.isAbsolute(targetPath)
      ? targetPath
      : path.join(this.root, targetPath);

    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) {
      throw new Error(`Path not found: ${fullPath}`);
    }

    if (stat.isDirectory()) {
      return this.scanDirectory(fullPath);
    }

    return this.scanFile(fullPath);
  }

  private async scanDirectory(dir: string): Promise<FunctionInfo[]> {
    const out: FunctionInfo[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.scanDirectory(child);
        out.push(...nested);
        continue;
      }
      if (entry.isFile()) {
        const extracted = await this.tryScanSupportedFile(child);
        out.push(...extracted);
      }
    }
    return out;
  }

  private async scanFile(filePath: string): Promise<FunctionInfo[]> {
    return this.tryScanSupportedFile(filePath, true);
  }

  private async tryScanSupportedFile(filePath: string, throwOnUnsupported = false): Promise<FunctionInfo[]> {
    const extractor = this.extractors.find(ex => ex.supports(filePath));
    if (!extractor) {
      if (throwOnUnsupported) {
        throw new Error(`Unsupported file type: ${filePath}`);
      }
      return [];
    }
    const source = await fs.readFile(filePath, "utf8");
    return extractor.extractFromText(filePath, source);
  }
}
