import fs from "fs/promises";
import path from "path";
import upath from "upath";
import crypto from "node:crypto";
import { FunctionInfo, IndexUnit } from "./types";
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

  async scan(targetPath: string): Promise<IndexUnit[]> {
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

  private async scanDirectory(dir: string): Promise<IndexUnit[]> {
    const out: IndexUnit[] = [];
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

  private async scanFile(filePath: string): Promise<IndexUnit[]> {
    return this.tryScanSupportedFile(filePath, true);
  }

  private async tryScanSupportedFile(filePath: string, throwOnUnsupported = false): Promise<IndexUnit[]> {
    const extractor = this.extractors.find(ex => ex.supports(filePath));
    if (!extractor) {
      if (throwOnUnsupported) {
        throw new Error(`Unsupported file type: ${filePath}`);
      }
      return [];
    }
    const source = await fs.readFile(filePath, "utf8");
    const fis = await extractor.extractFromText(filePath, source);
    return fis.map(fi => {
      const rel = this.relPath(fi.fullPath);
      const id = `${rel}:${fi.startLine}-${fi.endLine}`;
      const hash = this.hashCode(fi.code);
      return {
        id,
        name: fi.name,
        filePath: rel,
        startLine: fi.startLine,
        endLine: fi.endLine,
        code: fi.code,
        embedding: undefined,
        hash,
      };
    });
  }

  private relPath(absPath: string): string {
    return upath.normalizeTrim(upath.relative(this.root, absPath));
  }

  private hashCode(code: string): string {
    return crypto.createHash("sha256").update(code).digest("hex");
  }
}
