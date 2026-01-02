import path from "path";
import type { Stats } from "fs";
import fs from "fs/promises";
import upath from "upath";
import crypto from "node:crypto";
import debug from "debug";
import { glob } from "glob-gitignore";
import { IndexUnit } from "./types";
import { LanguageExtractor } from "./extractors/LanguageExtractor";
import { JavaExtractor } from "./extractors/java";
import { FILE_CHECKSUM_ALGO } from "./const";
import { configStore } from "./config/configStore";
import { DryConfig } from "./types";
import { Gitignore } from "./Gitignore"
import { Ignore } from "ignore";

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
  private readonly gitignore: Gitignore;

  constructor(
    rootPath: string,
    extractors?: LanguageExtractor[]
  ) {
    this.root = rootPath;
    this.extractors = extractors ?? defaultExtractors(rootPath);
    this.gitignore = new Gitignore(this.root);
    log("Initialized extractor for %s", this.root);
  }

  /**
   * Lists all supported source files from a path. Honors exclusion globs from config.
   */
  async listSourceFiles(dirPath: string): Promise<string[]> {
    const target = await this.resolveTarget(dirPath);
    const config = await this.loadConfig();
    const ignoreMatcher = await this.gitignore.buildMatcher(config);

    if (target.stat.isFile()) {
      return this.filterSingleFile(target.baseRel, ignoreMatcher);
    }

    const matches = await this.globSourceFiles(target.baseRel);
    return this.filterSupportedFiles(matches, ignoreMatcher);
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
   * Scans a directory recursively, extracting units from supported files while honoring exclusions.
   */
  private async scanDirectory(dir: string): Promise<IndexUnit[]> {
    const out: IndexUnit[] = [];
    const relDir = this.relPath(dir);
    const files = await this.listSourceFiles(relDir);
    for (const relFile of files) {
      const absFile = path.join(this.root, relFile);
      const extracted = await this.tryScanSupportedFile(absFile);
      out.push(...extracted);
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
    const extractor = this.extractors.find(ex => ex.supports(filePath));
    if (!extractor) {
      if (throwOnUnsupported) {
        throw new Error(`Unsupported file type: ${filePath}`);
      }
      return [];
    }
    const rel = this.relPath(filePath);
    if (await this.shouldExclude(rel)) {
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
    return this.normalizeRelPath(upath.relative(this.root, absPath));
  }

  /**
   * Returns true if a repo-relative path matches any configured exclusion glob.
   */
  private async shouldExclude(relPath: string): Promise<boolean> {
    const config = await this.loadConfig();
    const ignoreMatcher = await this.gitignore.buildMatcher(config);
    return ignoreMatcher.ignores(this.normalizeRelPath(relPath));
  }

  private async loadConfig(): Promise<DryConfig> {
    return await configStore.get(this.root);
  }

  /**
   * Normalizes repo-relative paths and strips leading "./" to keep matcher inputs consistent.
   */
  private normalizeRelPath(relPath: string): string {
    const normalized = upath.normalizeTrim(relPath);
    return normalized.startsWith("./") ? normalized.slice(2) : normalized;
  }

  private async resolveTarget(dirPath: string): Promise<{ fullPath: string; baseRel: string; stat: Stats; }> {
    const fullPath = path.isAbsolute(dirPath) ? dirPath : path.join(this.root, dirPath);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) {
      throw new Error(`Path not found: ${fullPath}`);
    }
    const baseRel = this.relPath(fullPath);
    log("Listing source files under %s", fullPath);
    return { fullPath, baseRel, stat };
  }

  private async filterSingleFile(baseRel: string, ignoreMatcher: Ignore): Promise<string[]> {
    const relFile = this.normalizeRelPath(baseRel);
    if (ignoreMatcher.ignores(relFile)) return [];
    return this.extractors.some((ex) => ex.supports(relFile)) ? [relFile] : [];
  }

  private async globSourceFiles(baseRel: string): Promise<string[]> {
    const pattern = baseRel ? `${baseRel.replace(/\\/g, "/")}/**/*` : "**/*";
    const matches = await glob(pattern, {
      cwd: this.root,
      dot: false,
      nodir: true,
    });
    return matches.map((p: string) => this.normalizeRelPath(p));
  }

  private filterSupportedFiles(relPaths: string[], ignoreMatcher: Ignore): string[] {
    return relPaths
      .filter((relPath: string) => !ignoreMatcher.ignores(relPath))
      .filter((relPath: string) => this.extractors.some((ex) => ex.supports(relPath)));
  }
}
