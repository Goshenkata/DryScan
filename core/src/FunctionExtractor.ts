import fs from "fs/promises";
import path from "path";
import upath from "upath";
import crypto from "node:crypto";
import { IndexUnit, IndexUnitType } from "./types";
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

  /**
  * Resolves and applies internal dependencies for a set of functions.
  * This is the main entry point for Phase 2 of the analysis.
  * 
  * @param units - Units to process
  * @param allUnits - Complete unit index for name lookup
  * @returns Units with callDependencies populated on functions
   */
  async applyInternalDependencies(units: IndexUnit[], allUnits: IndexUnit[]): Promise<IndexUnit[]> {
    const functions = allUnits.filter(u => u.unitType === IndexUnitType.FUNCTION);
    const nameIndex = this.buildNameIndex(functions);

    return units.map(unit => {
      if (unit.unitType !== IndexUnitType.FUNCTION) return unit;
      return this.applyInternalDependenciesToFunction(unit, nameIndex);
    });
  }

  /**
   * Applies internal dependencies to a single function (partial operation).
   * Extracts call expressions from the function's AST and resolves them to local functions.
   */
  private applyInternalDependenciesToFunction(fn: IndexUnit, nameIndex: Map<string, IndexUnit[]>): IndexUnit {
    const extractor = this.findExtractor(fn.filePath);
    if (!extractor) return fn;

    const callNames = extractor.extractCallsFromUnit(fn.filePath, fn.id);
    const resolvedFunctions = this.resolveInternalCalls(callNames, nameIndex, fn.filePath);

    const functionRefs = resolvedFunctions.map(f => ({
      id: f.id,
      name: f.name,
      filePath: f.filePath,
      startLine: f.startLine,
      endLine: f.endLine,
      code: f.code,
      unitType: f.unitType,
      parentId: f.parentId,
    }));

    return { ...fn, callDependencies: functionRefs };
  }

  /**
   * Resolves call names to actual local functions using the name index.
   * Filters out library/external calls (not in index) and deduplicates.
   */
  private resolveInternalCalls(callNames: string[], nameIndex: Map<string, IndexUnit[]>, currentFile: string): IndexUnit[] {
    const resolved: IndexUnit[] = [];
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
  private findBestMatch(candidates: IndexUnit[], currentFile: string): IndexUnit | null {
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
  private buildNameIndex(functions: IndexUnit[]): Map<string, IndexUnit[]> {
    const index = new Map<string, IndexUnit[]>();

    for (const fn of functions) {
      const simpleName = this.extractSimpleName(fn.name);
      const existingSimple = index.get(simpleName) || [];
      existingSimple.push(fn);
      index.set(simpleName, existingSimple);

      const qualified = index.get(fn.name) || [];
      qualified.push(fn);
      index.set(fn.name, qualified);
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
    const rel = this.relPath(filePath);
    const units = await extractor.extractFromText(rel, source);
    return units.map(unit => ({
      ...unit,
      filePath: rel,
      embedding: undefined,
    }));
  }

  private relPath(absPath: string): string {
    return upath.normalizeTrim(upath.relative(this.root, absPath));
  }
}
