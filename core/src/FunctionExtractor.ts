import fs from "fs/promises";
import path from "path";
import upath from "upath";
import crypto from "node:crypto";
import { FunctionInfo } from "./types";
import { LanguageExtractor } from "./extractors/LanguageExtractor";
import { JavaScriptExtractor } from "./extractors/javascript";
import { JavaExtractor } from "./extractors/java";

export { LanguageExtractor } from "./extractors/LanguageExtractor";

export function defaultExtractors(): LanguageExtractor[] {
  return [new JavaScriptExtractor(), new JavaExtractor()];
}

export class FunctionExtractor {
  private readonly root: string;
  private readonly extractors: LanguageExtractor[];

  constructor(rootPath: string, extractors: LanguageExtractor[] = defaultExtractors()) {
    this.root = rootPath;
    this.extractors = extractors;
  }

  /**
   * Lists all supported source files in a directory recursively.
   * Only returns files that have a matching extractor.
   */
  async listSourceFiles(dirPath: string): Promise<string[]> {
    const fullPath = path.isAbsolute(dirPath)
      ? dirPath
      : path.join(this.root, dirPath);

    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) {
      throw new Error(`Path not found: ${fullPath}`);
    }

    if (stat.isFile()) {
      // Single file: check if supported
      const supported = this.extractors.some(ex => ex.supports(fullPath));
      return supported ? [this.relPath(fullPath)] : [];
    }

    // Directory: recursively list all supported files
    return this.listSourceFilesInDirectory(fullPath);
  }

  /**
   * Recursively lists all supported source files in a directory.
   */
  private async listSourceFilesInDirectory(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        const nested = await this.listSourceFilesInDirectory(child);
        files.push(...nested);
      } else if (entry.isFile()) {
        const supported = this.extractors.some(ex => ex.supports(child));
        if (supported) {
          files.push(this.relPath(child));
        }
      }
    }
    
    return files;
  }

  /**
   * Computes MD5 checksum of file content.
   * Used to detect file changes during incremental updates.
   */
  async computeChecksum(filePath: string): Promise<string> {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.root, filePath);
    
    const content = await fs.readFile(fullPath, "utf8");
    return crypto.createHash("md5").update(content).digest("hex");
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

  /**
   * Resolves and applies internal dependencies for a set of functions.
   * This is the main entry point for Phase 2 of the analysis.
   * 
   * @param functions - Functions to process
   * @param allFunctions - Complete function index for name lookup
   * @returns Functions with internalFunctions populated
   */
  async applyInternalDependencies(functions: FunctionInfo[], allFunctions: FunctionInfo[]): Promise<FunctionInfo[]> {
    const nameIndex = this.buildNameIndex(allFunctions);
    return functions.map(fn => this.applyInternalDependenciesToFunction(fn, nameIndex));
  }

  /**
   * Applies internal dependencies to a single function (partial operation).
   * Extracts call expressions from the function's AST and resolves them to local functions.
   */
  private applyInternalDependenciesToFunction(fn: FunctionInfo, nameIndex: Map<string, FunctionInfo[]>): FunctionInfo {
    const extractor = this.findExtractor(fn.filePath);
    if (!extractor) return fn;

    const callNames = extractor.extractCallsFromFunction(fn.filePath, fn.id);
    const internalFunctions = this.resolveInternalCalls(callNames, nameIndex, fn.filePath);

    // Create lightweight references (only id is required for relation)
    const functionRefs = internalFunctions.map(f => ({
      id: f.id,
      name: f.name,
      filePath: f.filePath,
      startLine: f.startLine,
      endLine: f.endLine,
      code: f.code
    }));

    return { ...fn, internalFunctions: functionRefs };
  }

  /**
   * Resolves call names to actual local functions using the name index.
   * Filters out library/external calls (not in index) and deduplicates.
   */
  private resolveInternalCalls(callNames: string[], nameIndex: Map<string, FunctionInfo[]>, currentFile: string): FunctionInfo[] {
    const resolved: FunctionInfo[] = [];
    const seen = new Set<string>();

    for (const callName of callNames) {
      const candidates = nameIndex.get(callName) || [];
      const match = this.findBestMatch(candidates, currentFile);
      if (match && !seen.has(match.id)) {
        resolved.push(match);
        seen.add(match.id);
      }
    }

    return resolved;
  }

  /**
   * Finds the best matching function from candidates.
   * Prefers same-file matches to handle name collisions.
   */
  private findBestMatch(candidates: FunctionInfo[], currentFile: string): FunctionInfo | null {
    if (candidates.length === 0) return null;
    
    // Prefer functions in the same file
    const sameFile = candidates.find(c => c.filePath === currentFile);
    if (sameFile) return sameFile;
    
    // Fallback to first candidate
    return candidates[0];
  }

  /**
   * Builds a name-based index for fast function lookup.
   * Extracts simple names from qualified names (e.g., "Sample.helper" -> "helper").
   */
  private buildNameIndex(functions: FunctionInfo[]): Map<string, FunctionInfo[]> {
    const index = new Map<string, FunctionInfo[]>();
    
    for (const fn of functions) {
      const simpleName = this.extractSimpleName(fn.name);
      const existing = index.get(simpleName) || [];
      existing.push(fn);
      index.set(simpleName, existing);
    }
    
    return index;
  }

  /**
   * Extracts the simple name from a qualified name.
   * E.g., "Sample.helper" -> "helper", "helper" -> "helper"
   */
  private extractSimpleName(fullName: string): string {
    const parts = fullName.split(".");
    return parts[parts.length - 1];
  }

  private findExtractor(filePath: string): LanguageExtractor | undefined {
    return this.extractors.find(ex => ex.supports(filePath));
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
    const rel = this.relPath(filePath);
    const fis = await extractor.extractFromText(rel, source);
    return fis.map(fi => {
      const id = `${fi.name}:${fi.startLine}-${fi.endLine}`;
      return {
        id,
        name: fi.name,
        filePath: rel,
        startLine: fi.startLine,
        endLine: fi.endLine,
        code: fi.code,
        embedding: undefined,
      };
    });
  }

  private relPath(absPath: string): string {
    return upath.normalizeTrim(upath.relative(this.root, absPath));
  }

}
