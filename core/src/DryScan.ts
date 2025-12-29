import upath from "upath";
import fs from "fs/promises";
import path from "path";
import debug from "debug";
import { DuplicateGroup, DuplicateAnalysisResult, DuplicationScore, IndexUnit, IndexUnitType } from "./types";
import { DRYSCAN_DIR, INDEX_DB } from "./const";
import { defaultExtractors, IndexUnitExtractor } from "./IndexUnitExtractor";
import { DryScanDatabase } from "./db/DryScanDatabase";
import { FileEntity } from "./db/entities/FileEntity";
import { cosineSimilarity } from "@langchain/core/utils/math";
import { performIncrementalUpdate, addEmbedding } from "./DryScanUpdater";
import { indexConfig } from "./config/indexConfig";
import { DryConfig, loadDryConfig, saveDryConfig } from "./config/dryconfig";
import { pairKeyForUnits, parsePairKey, pairKeyMatches, ParsedPairKey } from "./pairs";
import { minimatch } from "minimatch";

const log = debug("DryScan");

export interface InitOptions {
  skipEmbeddings?: boolean;
}


export class DryScan {
  repoPath: string;
  private extractor?: IndexUnitExtractor;
  private db: DryScanDatabase;
  private config?: DryConfig;
  private configPromise: Promise<DryConfig>;

  constructor(
    repoPath: string,
    config?: DryConfig,
    extractor?: IndexUnitExtractor,
    db?: DryScanDatabase
  ) {
    this.repoPath = repoPath;
    this.config = config;
    this.configPromise = config ? Promise.resolve(config) : loadDryConfig(repoPath);
    this.extractor = extractor;
    this.db = db ?? new DryScanDatabase();
  }

  /**
   * Initializes the DryScan repository with a 3-phase analysis:
   * Phase 1: Extract and save all functions
   * Phase 2: Resolve and save internal dependencies
   * Phase 3: Compute and save semantic embeddings
   */
  async init(options?: InitOptions): Promise<void> {
    log("Initializing DryScan repository at", this.repoPath);
    if (await this.isInitialized()) {
      log("Repository already initialized.");
      return;
    }
    const config = await this.ensureConfig();
    await this.ensureExtractor();
    const dbPath = upath.join(this.repoPath, DRYSCAN_DIR, INDEX_DB);
    await fs.mkdir(upath.dirname(dbPath), { recursive: true });
    await this.db.init(dbPath);

    log("Phase 1: Extracting index units...");
    await this.initUnits();
    log("Phase 2: Resolving internal dependencies for methods...");
    await this.applyDependencies();
    log("Phase 3: Computing embeddings for all units...");
    await this.computeEmbeddings(options?.skipEmbeddings === true);
    log("Phase 4: Tracking files...");
    await this.trackFiles();
    await this.cleanupExcludedFiles(config);
    log("DryScan initialization complete.");
  }

  /**
   * Updates the index by detecting changed, new, and deleted files.
   * Only reprocesses functions in changed files for efficiency.
   * Delegates to DryScanUpdater module for implementation.
   * 
   * Update process:
   * 1. List all current source files in repository
   * 2. For each file, check if it's new, changed, or unchanged (via mtime + checksum)
   * 3. Remove old functions from changed/deleted files
   * 4. Extract and save functions from new/changed files
   * 5. Recompute internal dependencies for affected functions
   * 6. Recompute embeddings for affected functions
   * 7. Update file tracking metadata
   */
  async updateIndex(): Promise<void> {
    log("Updating DryScan index at", this.repoPath);
    const config = await this.ensureConfig();
    const extractor = await this.ensureExtractor();
    
    // Ensure DB is initialized
    if (!this.db.isInitialized()) {
      const dbPath = upath.join(this.repoPath, DRYSCAN_DIR, INDEX_DB);
      await this.db.init(dbPath);
    }

    try {
      await performIncrementalUpdate(this.repoPath, extractor, this.db);
      await this.cleanupExcludedFiles(config);
      log("Index update complete.");
    } catch (err) {
      log("Error during index update:", err);
      throw err;
    }
  }

  /**
  * Phase 1: Scans repository and extracts all index units.
  * Saves units to DB.
   */
  private async initUnits(): Promise<void> {
    try {
      const extractor = await this.ensureExtractor();
      const units = await extractor.scan(this.repoPath);
      log(`Extracted ${units.length} index units.`);
      await this.db.saveUnits(units);
      log("Index units saved to database.");
    } catch (err) {
      log("Error during unit extraction:", err);
      throw err;
    }
  }

  /**
   * Phase 2: Resolves internal dependencies for all functions.
   * Loads all functions, applies dependency resolution, and saves back.
   */
  private async applyDependencies(): Promise<void> {
    try {
      const allUnits = await this.db.getAllUnits();
      const extractor = await this.ensureExtractor();
      const updated = await extractor.applyInternalDependencies(allUnits, allUnits);
      log("Resolved internal dependencies for all functions.");
      await this.db.updateUnits(updated);
      log("Updated units with dependencies in database.");
    } catch (err) {
      log("Error during dependency resolution:", err);
      throw err;
    }
  }

  /**
   * Phase 3: Computes semantic embeddings for duplicate detection.
   */
  private async computeEmbeddings(skipEmbeddings: boolean = false): Promise<void> {
    if (skipEmbeddings) {
      log("Skipping embedding computation by request.");
      return;
    }
    try {
      const allUnits = await this.db.getAllUnits();
      log(`Computing embeddings for ${allUnits.length} units...`);
      const updated: IndexUnit[] = await Promise.all(allUnits.map(unit => addEmbedding(unit)));
      await this.db.updateUnits(updated);
      log("Embeddings computed and saved.");
    } catch (err) {
      log("Error during embedding computation:", err);
      throw err;
    }
  }

  /**
   * Phase 4: Tracks all source files with checksums and mtime.
   * Enables efficient change detection in future updates.
   */
  private async trackFiles(): Promise<void> {
    try {
      const extractor = await this.ensureExtractor();
      const allFunctions = await extractor.listSourceFiles(this.repoPath);
      const fileEntities: FileEntity[] = [];
    
      for (const relPath of allFunctions) {
        const fullPath = path.join(this.repoPath, relPath);
        const stat = await fs.stat(fullPath);
        const checksum = await extractor.computeChecksum(fullPath);
      
        const fileEntity = new FileEntity();
        fileEntity.filePath = relPath;
        fileEntity.checksum = checksum;
        fileEntity.mtime = stat.mtimeMs;
      
        fileEntities.push(fileEntity);
      }
    
      await this.db.saveFiles(fileEntities);
      log(`Tracked ${fileEntities.length} files.`);
    } catch (err) {
      log("Error during file tracking:", err);
      throw err;
    }
  }
  

  /**
   * Finds duplicate code blocks using cosine similarity on embeddings.
   * Automatically updates the index before searching to ensure results are current.
   * Compares all function pairs and returns groups with similarity above threshold.
   * 
   * @param threshold - Minimum similarity score (0-1) to consider functions as duplicates. Default: 0.85
   * @returns Analysis result with duplicate groups and duplication score
   */
  async findDuplicates(threshold?: number): Promise<DuplicateAnalysisResult> {
    log("Finding duplicates with threshold", threshold);
    const config = await this.ensureConfig();
    await this.ensureExtractor();
    
    // Initialize database if needed
    if (!this.db.isInitialized()) {
      const dbPath = upath.join(this.repoPath, DRYSCAN_DIR, INDEX_DB);
      await this.db.init(dbPath);
    }
    
    // Step 1: Update index to ensure we have the latest code
    log("Step 1: Updating index to ensure latest code is analyzed...");
    await this.updateIndex();
    log("Index update complete. Proceeding with duplicate detection.");
    
    // Step 2: Load all functions and filter those with embeddings
    log("Step 2: Loading functions from database...");
    const allUnits = await this.db.getAllUnits();
    const unitsWithEmbeddings = allUnits.filter(unit => unit.embedding && unit.embedding.length > 0);
    
    log(`Comparing ${unitsWithEmbeddings.length} units with embeddings`);
    
    if (unitsWithEmbeddings.length < 2) {
      log("Not enough units with embeddings to compare");
      const score = this.computeDuplicationScore([], allUnits);
      return { duplicates: [], score };
    }
    
    // Step 3: Compute duplicates using cosine similarity
    log("Step 3: Computing similarity between unit pairs...");
    const thresholds = this.resolveThresholds(threshold ?? config.threshold);
    const duplicates = this.computeDuplicates(unitsWithEmbeddings, thresholds);
    const filteredDuplicates = duplicates.filter((group) => !this.isGroupExcluded(group, config));
    log(`Found ${filteredDuplicates.length} duplicate groups`);
    
    // Step 4: Compute duplication score
    const score = this.computeDuplicationScore(filteredDuplicates, allUnits);
    log(`Duplication score: ${score.score.toFixed(2)}% (${score.grade})`);
    
    return { duplicates: filteredDuplicates, score };
  }

  /**
   * Cleans excludedPairs entries that no longer match any indexed units.
   * Runs an update first to ensure the index reflects current code.
   */
  async cleanExclusions(): Promise<{ removed: number; kept: number }> {
    const config = await this.ensureConfig();
    await this.ensureExtractor();

    await this.updateIndex();
    const units = await this.db.getAllUnits();

    const actualPairsByType = {
      [IndexUnitType.CLASS]: this.buildPairKeys(units, IndexUnitType.CLASS),
      [IndexUnitType.FUNCTION]: this.buildPairKeys(units, IndexUnitType.FUNCTION),
      [IndexUnitType.BLOCK]: this.buildPairKeys(units, IndexUnitType.BLOCK),
    };

    const kept: string[] = [];
    const removed: string[] = [];

    for (const entry of config.excludedPairs || []) {
      const parsed = parsePairKey(entry);
      if (!parsed) {
        removed.push(entry);
        continue;
      }

      const candidates = actualPairsByType[parsed.type];
      const matched = candidates.some((actual) => pairKeyMatches(actual, parsed));
      if (matched) {
        kept.push(entry);
      } else {
        removed.push(entry);
      }
    }

    const nextConfig: DryConfig = { ...config, excludedPairs: kept };
    await saveDryConfig(this.repoPath, nextConfig);
    this.config = nextConfig;
    if (this.extractor) {
      this.extractor.setConfig(nextConfig);
    }
    log(`Cleaned exclusions. Kept=${kept.length}, removed=${removed.length}`);
    return { removed: removed.length, kept: kept.length };
  }

  private buildPairKeys(units: IndexUnit[], type: IndexUnitType): ParsedPairKey[] {
    const typed = units.filter((u) => u.unitType === type);
    const pairs: ParsedPairKey[] = [];
    for (let i = 0; i < typed.length; i++) {
      for (let j = i + 1; j < typed.length; j++) {
        const key = pairKeyForUnits(typed[i], typed[j]);
        const parsed = key ? parsePairKey(key) : null;
        if (parsed) {
          pairs.push(parsed);
        }
      }
    }
    return pairs;
  }

  private resolveThresholds(functionThreshold?: number): { function: number; block: number; class: number } {
    const defaults = indexConfig.thresholds;
    const clamp = (value: number) => Math.min(1, Math.max(0, value));

    // Preserve caller-provided function threshold; derive others by their default offsets.
    const base = functionThreshold ?? defaults.function;
    const blockOffset = defaults.block - defaults.function;
    const classOffset = defaults.class - defaults.function;

    const functionThresholdValue = clamp(base);
    return {
      function: functionThresholdValue,
      block: clamp(functionThresholdValue + blockOffset),
      class: clamp(functionThresholdValue + classOffset),
    };
  }

  /**
   * Computes duplicate groups by comparing all function pairs using cosine similarity.
   * Only compares each pair once (i < j) to avoid redundant comparisons.
   * 
   * @param functions - Functions with embeddings to compare
   * @param thresholds - Per-unit-type similarity thresholds
   * @returns Sorted array of duplicate groups (highest similarity first)
   */
  private computeDuplicates(
    units: IndexUnit[],
    thresholds: { function: number; block: number; class: number }
  ): DuplicateGroup[] {
    const duplicates: DuplicateGroup[] = [];
    const byType = new Map<IndexUnitType, IndexUnit[]>();

    for (const unit of units) {
      const list = byType.get(unit.unitType) ?? [];
      list.push(unit);
      byType.set(unit.unitType, list);
    }

    for (const [type, typedUnits] of byType.entries()) {
      const threshold = this.getThreshold(type, thresholds);

      for (let i = 0; i < typedUnits.length; i++) {
        for (let j = i + 1; j < typedUnits.length; j++) {
          const left = typedUnits[i];
          const right = typedUnits[j];

          if (!left.embedding || !right.embedding) continue;

          const similarity = this.computeWeightedSimilarity(left, right);
          if (similarity >= threshold) {
            duplicates.push({
              id: `${left.id}::${right.id}`,
              similarity,
              left: {
                name: left.name,
                filePath: left.filePath,
                startLine: left.startLine,
                endLine: left.endLine,
                code: left.code,
                unitType: left.unitType,
              },
              right: {
                name: right.name,
                filePath: right.filePath,
                startLine: right.startLine,
                endLine: right.endLine,
                code: right.code,
                unitType: right.unitType,
              },
            });
          }
        }
      }
    }

    return duplicates.sort((a, b) => b.similarity - a.similarity);
  }

  private isGroupExcluded(group: DuplicateGroup, config: DryConfig): boolean {
    if (!config.excludedPairs || config.excludedPairs.length === 0) return false;
    const key = pairKeyForUnits(group.left, group.right);
    if (!key) return false;
    const actual = parsePairKey(key);
    if (!actual) return false;
    return config.excludedPairs.some((entry) => {
      const parsed = parsePairKey(entry);
      return parsed ? pairKeyMatches(actual, parsed) : false;
    });
  }

  private getThreshold(type: IndexUnitType, thresholds: { function: number; block: number; class: number }): number {
    if (type === IndexUnitType.CLASS) return thresholds.class;
    if (type === IndexUnitType.BLOCK) return thresholds.block;
    return thresholds.function;
  }

  private computeWeightedSimilarity(left: IndexUnit, right: IndexUnit): number {
    if (!left.embedding || !right.embedding) return 0;

    const selfSimilarity = cosineSimilarity([left.embedding], [right.embedding])[0][0];

    if (left.unitType === IndexUnitType.CLASS) {
      return selfSimilarity * indexConfig.weights.class.self;
    }

    if (left.unitType === IndexUnitType.FUNCTION) {
      const parentClassSimilarity = this.parentSimilarity(left, right, IndexUnitType.CLASS);
      const weights = indexConfig.weights.function;
      return (weights.self * selfSimilarity) + (weights.parentClass * parentClassSimilarity);
    }

    // Block
    const weights = indexConfig.weights.block;
    const parentFuncSim = this.parentSimilarity(left, right, IndexUnitType.FUNCTION);
    const parentClassSim = this.parentSimilarity(left, right, IndexUnitType.CLASS);
    return (
      weights.self * selfSimilarity +
      weights.parentFunction * parentFuncSim +
      weights.parentClass * parentClassSim
    );
  }

  private parentSimilarity(left: IndexUnit, right: IndexUnit, targetType: IndexUnitType): number {
    const leftParent = this.findParentOfType(left, targetType);
    const rightParent = this.findParentOfType(right, targetType);
    if (!leftParent || !rightParent || !leftParent.embedding || !rightParent.embedding) return 0;
    return cosineSimilarity([leftParent.embedding], [rightParent.embedding])[0][0];
  }

  private findParentOfType(unit: IndexUnit, targetType: IndexUnitType): IndexUnit | null {
    let current: IndexUnit | undefined | null = unit.parent;
    while (current) {
      if (current.unitType === targetType) return current;
      current = current.parent;
    }
    return null;
  }

  /**
   * Computes a duplication score using weighted impact formula:
   * score = Σ(similarity × lines_in_duplicate_pair) / total_lines_of_code × 100
   * 
   * This accounts for both how similar duplicates are and their size impact.
   * 
   * @param duplicates - Array of detected duplicate groups
   * @param allUnits - All code units in the codebase
   * @returns Duplication score with grade and metrics
   */
  private computeDuplicationScore(duplicates: DuplicateGroup[], allUnits: IndexUnit[]): DuplicationScore {
    const totalLines = this.calculateTotalLines(allUnits);
    
    if (totalLines === 0 || duplicates.length === 0) {
      return {
        score: 0,
        grade: 'Excellent',
        totalLines,
        duplicateLines: 0,
        duplicateGroups: 0,
      };
    }
    
    // Calculate weighted duplicate lines using similarity as weight
    const weightedDuplicateLines = duplicates.reduce((sum, group) => {
      const leftLines = group.left.endLine - group.left.startLine + 1;
      const rightLines = group.right.endLine - group.right.startLine + 1;
      const avgLines = (leftLines + rightLines) / 2;
      return sum + (group.similarity * avgLines);
    }, 0);
    
    const score = (weightedDuplicateLines / totalLines) * 100;
    const grade = this.getScoreGrade(score);
    
    return {
      score,
      grade,
      totalLines,
      duplicateLines: Math.round(weightedDuplicateLines),
      duplicateGroups: duplicates.length,
    };
  }

  /**
   * Calculates total lines of code across all units.
   */
  private calculateTotalLines(units: IndexUnit[]): number {
    return units.reduce((sum, unit) => {
      const lines = unit.endLine - unit.startLine + 1;
      return sum + lines;
    }, 0);
  }

  /**
   * Determines the grade based on duplication score percentage.
   * Lower scores are better (less duplication).
   */
  private getScoreGrade(score: number): 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Critical' {
    if (score < 5) return 'Excellent';
    if (score < 15) return 'Good';
    if (score < 30) return 'Fair';
    if (score < 50) return 'Poor';
    return 'Critical';
  }

  private async ensureConfig(): Promise<DryConfig> {
    if (this.config) {
      log("Using cached config for %s", this.repoPath);
      return this.config;
    }
    log("Loading config for %s", this.repoPath);
    this.config = await this.configPromise;
    return this.config;
  }

  private async ensureExtractor(): Promise<IndexUnitExtractor> {
    const config = await this.ensureConfig();
    if (!this.extractor) {
      log("Creating index unit extractor with current config");
      this.extractor = new IndexUnitExtractor(this.repoPath, config, defaultExtractors());
      return this.extractor;
    }
    log("Refreshing extractor configuration");
    this.extractor.setConfig(config);
    return this.extractor;
  }

  private pathExcluded(filePath: string, config: DryConfig): boolean {
    if (!config.excludedPaths || config.excludedPaths.length === 0) return false;
    return config.excludedPaths.some((pattern) => minimatch(filePath, pattern, { dot: true }));
  }

  private async cleanupExcludedFiles(config: DryConfig): Promise<void> {
    if (!config.excludedPaths || config.excludedPaths.length === 0) return;
    const units = await this.db.getAllUnits();
    const files = await this.db.getAllFiles();

    const unitPathsToRemove = new Set<string>();
    for (const unit of units) {
      if (this.pathExcluded(unit.filePath, config)) {
        unitPathsToRemove.add(unit.filePath);
      }
    }

    const filePathsToRemove = new Set<string>();
    for (const file of files) {
      if (this.pathExcluded(file.filePath, config)) {
        filePathsToRemove.add(file.filePath);
      }
    }

    const paths = [...new Set([...unitPathsToRemove, ...filePathsToRemove])];
    if (paths.length > 0) {
      await this.db.removeUnitsByFilePaths(paths);
      await this.db.removeFilesByFilePaths(paths);
      log(`Removed excluded paths from index: ${paths.length}`);
    }
  }

  private async isInitialized(): Promise<boolean> {
    const indexPath = upath.join(this.repoPath, DRYSCAN_DIR, INDEX_DB);
    try {
      const stat = await fs.stat(indexPath);
      log("Index file found at", indexPath);
      return stat.isFile();
    } catch (err: any) {
      if (err.code === "ENOENT") {
        log("Index file not found at", indexPath);
        return false;
      }
      log("Error checking initialization:", err);
      throw err;
    }
  }
}
