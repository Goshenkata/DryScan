import path from "path";
import fs from "fs/promises";
import upath from "upath";
import crypto from "node:crypto";
import debug from "debug";
import { IndexUnit, IndexUnitType } from "./types";
import { LanguageExtractor } from "./extractors/LanguageExtractor";
import { JavaExtractor } from "./extractors/java";
import { minimatch } from "minimatch";
import { FILE_CHECKSUM_ALGO } from "./const";
import { configStore } from "./config/configStore";
import { DryConfig } from "./config/dryconfig";

const log = debug("DryScan:Extractor");

export type { LanguageExtractor } from "./extractors/LanguageExtractor";
/**
 * Returns the default set of language extractors supported by DryScan.
 * Extend/override by passing custom extractors into the IndexUnitExtractor constructor.
 */
export function defaultExtractors(repoPath: string): LanguageExtractor[] {
  return [new JavaExtractor(repoPath)];
}

/**
 * Extracts and indexes code units (classes, functions, blocks) for a repository.
 * Owns shared file-system helpers and delegates language-specific parsing to LanguageExtractors.
 */
export class IndexUnitExtractor {
  private readonly root: string;
  readonly extractors: LanguageExtractor[];
  private config?: DryConfig;

  constructor(
    rootPath: string,
    extractors?: LanguageExtractor[]
  ) {
    this.root = rootPath;
    this.extractors = extractors ?? defaultExtractors(rootPath);
    log("Initialized extractor for %s", this.root);
  }

  /**
   * Lists all supported source files from a path. Honors exclusion globs from config.
   */
  async listSourceFiles(dirPath: string): Promise<string[]> {
    await this.loadConfig();
    const fullPath = path.isAbsolute(dirPath)
      ? dirPath
      : path.join(this.root, dirPath);

    log("Listing source files under %s", fullPath);

    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) {
      throw new Error(`Path not found: ${fullPath}`);
    }

    if (stat.isFile()) {
      const supported = this.extractors.some(ex => ex.supports(fullPath));
      const rel = this.relPath(fullPath);
      if (this.shouldExclude(rel)) {
        log("Skipping excluded file %s", rel);
        return [];
      }
      return supported ? [rel] : [];
    }

    return this.listSourceFilesInDirectory(fullPath);
  }

  /**
   * Recursively walks a directory and collects supported files.
   */
  private async listSourceFilesInDirectory(dir: string): Promise<string[]> {
    await this.loadConfig();
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      const relChild = this.relPath(child);

      if (this.shouldExclude(relChild)) {
        log("Skipping excluded path %s", relChild);
        continue;
      }

      if (entry.isDirectory()) {
        const nested = await this.listSourceFilesInDirectory(child);
        files.push(...nested);
      } else if (entry.isFile()) {
        const supported = this.extractors.some(ex => ex.supports(child));
        if (supported) {
          files.push(relChild);
        }
      }
    }

    return files;
  }

  /**
   * Computes MD5 checksum of file content to track changes.
   */
  async computeChecksum(filePath: string): Promise<string> {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.root, filePath);

    const content = await fs.readFile(fullPath, "utf8");
    return crypto.createHash(FILE_CHECKSUM_ALGO).update(content).digest("hex");
  }

  /**
   * Scans a file or directory and extracts indexable units using the matching LanguageExtractor.
   * The returned units have repo-relative file paths and no embedding attached.
   */
  async scan(targetPath: string): Promise<IndexUnit[]> {
    await this.loadConfig();
    const fullPath = path.isAbsolute(targetPath)
      ? targetPath
      : path.join(this.root, targetPath);

    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) {
      throw new Error(`Path not found: ${fullPath}`);
    }

    if (stat.isDirectory()) {
      log("Scanning directory %s", fullPath);
      return this.scanDirectory(fullPath);
    }

    return this.scanFile(fullPath);
  }

  /**
   * Resolves and applies internal dependencies for a set of functions (Phase 2).
   */
  async applyInternalDependencies(units: IndexUnit[], allUnits: IndexUnit[]): Promise<IndexUnit[]> {
    log("Resolving internal dependencies for %d units", units.length);
    const functions = allUnits.filter(u => u.unitType === IndexUnitType.FUNCTION);
    const nameIndex = this.buildNameIndex(functions);

    return units.map(unit => {
      if (unit.unitType !== IndexUnitType.FUNCTION) return unit;
      return this.applyInternalDependenciesToFunction(unit, nameIndex);
    });
  }

  /**
   * Enriches a single FUNCTION unit by resolving its call sites into references
   * to other locally-indexed FUNCTION units (best-effort, name-based resolution).
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
   * Resolves extracted call names to known local functions, preferring same-file definitions.
   * De-duplicates resolved functions to avoid repeated dependencies.
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
   * Chooses the "best" candidate function for a call when multiple definitions share a name.
   * Current heuristic: prefer same-file; otherwise take the first indexed candidate.
   */
  private findBestMatch(candidates: IndexUnit[], currentFile: string): IndexUnit | null {
    if (candidates.length === 0) return null;

    const sameFile = candidates.find(c => c.filePath === currentFile);
    if (sameFile) return sameFile;

    return candidates[0];
  }

  /**
   * Builds a lookup index from function names to candidate FUNCTION units.
   * Stores both the fully-qualified name and a "simple" last-segment variant (e.g. a.b.c -> c).
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
   * Extracts the last segment of a dotted/qualified function name.
   */
  private extractSimpleName(fullName: string): string {
    const parts = fullName.split(".");
    return parts[parts.length - 1];
  }

  /**
   * Finds the language extractor responsible for a given file path, if any.
   */
  private findExtractor(filePath: string): LanguageExtractor | undefined {
    return this.extractors.find(ex => ex.supports(filePath));
  }

  /**
   * Scans a directory recursively, extracting units from supported files while honoring exclusions.
   */
  private async scanDirectory(dir: string): Promise<IndexUnit[]> {
    await this.loadConfig();
    const out: IndexUnit[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      const relChild = this.relPath(child);
      if (this.shouldExclude(relChild)) {
        log("Skipping excluded path %s", relChild);
        continue;
      }
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

  /**
   * Scans a single file and extracts supported units.
   */
  private async scanFile(filePath: string): Promise<IndexUnit[]> {
    return this.tryScanSupportedFile(filePath, true);
  }

  /**
   * Extracts units from a supported file.
   * Optionally throws when the file type is unsupported (used when scanning an explicit file).
   */
  private async tryScanSupportedFile(filePath: string, throwOnUnsupported = false): Promise<IndexUnit[]> {
    await this.loadConfig();
    const extractor = this.extractors.find(ex => ex.supports(filePath));
    if (!extractor) {
      if (throwOnUnsupported) {
        throw new Error(`Unsupported file type: ${filePath}`);
      }
      return [];
    }
    const rel = this.relPath(filePath);
    if (this.shouldExclude(rel)) {
      log("Skipping excluded file %s", rel);
      return [];
    }
    const source = await fs.readFile(filePath, "utf8");
    const units = await extractor.extractFromText(rel, source);
    log("Extracted %d units from %s", units.length, rel);
    return units.map(unit => ({
      ...unit,
      filePath: rel,
      embedding: undefined,
    }));
  }

  /**
   * Converts an absolute path to a repo-relative, normalized (POSIX-style) path.
   * This keeps paths stable across platforms and consistent in the index/DB.
   */
  private relPath(absPath: string): string {
    return upath.normalizeTrim(upath.relative(this.root, absPath));
  }

  /**
   * Returns true if a repo-relative path matches any configured exclusion glob.
   */
  private shouldExclude(relPath: string): boolean {
    const config = this.config;
    const patterns = config?.excludedPaths || [];
    if (patterns.length === 0) return false;
    return patterns.some((pattern) => minimatch(relPath, pattern, { dot: true }));
  }

  private async loadConfig(): Promise<void> {
    this.config = await configStore.get(this.root);
  }
}
