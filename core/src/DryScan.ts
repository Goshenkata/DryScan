import upath from "upath";
import fs from "fs/promises";
import path from "path";
import debug from "debug";
import { DuplicateGroup, DuplicateAnalysisResult, DuplicationScore, IndexUnit, IndexUnitType } from "./types";
import { DRYSCAN_DIR, INDEX_DB } from "./const";
import { defaultExtractors, FunctionExtractor } from "./FunctionExtractor";
import { DryScanDatabase } from "./db/DryScanDatabase";
import { FileEntity } from "./db/entities/FileEntity";
import { cosineSimilarity } from "@langchain/core/utils/math";
import { performIncrementalUpdate, addEmbedding } from "./DryScanUpdater";
import { indexConfig } from "./config/indexConfig";

const log = debug("DryScan");

export interface InitOptions {
  skipEmbeddings?: boolean;
}


export class DryScan {
  repoPath: string;
  private functionExtractor: FunctionExtractor;
  private db: DryScanDatabase;

  constructor(
    repoPath: string,
    functionExtractor?: FunctionExtractor,
    db?: DryScanDatabase
  ) {
    this.repoPath = repoPath;
    this.functionExtractor = functionExtractor ?? new FunctionExtractor(repoPath, defaultExtractors());
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
    
    // Ensure DB is initialized
    if (!this.db.isInitialized()) {
      const dbPath = upath.join(this.repoPath, DRYSCAN_DIR, INDEX_DB);
      await this.db.init(dbPath);
    }

    try {
      await performIncrementalUpdate(this.repoPath, this.functionExtractor, this.db);
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
      const units = await this.functionExtractor.scan(this.repoPath);
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
      const updated = await this.functionExtractor.applyInternalDependencies(allUnits, allUnits);
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
      const allFunctions = await this.functionExtractor.listSourceFiles(this.repoPath);
      const fileEntities: FileEntity[] = [];
    
      for (const relPath of allFunctions) {
        const fullPath = path.join(this.repoPath, relPath);
        const stat = await fs.stat(fullPath);
        const checksum = await this.functionExtractor.computeChecksum(fullPath);
      
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
    const duplicates = this.computeDuplicates(unitsWithEmbeddings, threshold ?? indexConfig.thresholds.function);
    log(`Found ${duplicates.length} duplicate groups`);
    
    // Step 4: Compute duplication score
    const score = this.computeDuplicationScore(duplicates, allUnits);
    log(`Duplication score: ${score.score.toFixed(2)}% (${score.grade})`);
    
    return { duplicates, score };
  }

  /**
   * Computes duplicate groups by comparing all function pairs using cosine similarity.
   * Only compares each pair once (i < j) to avoid redundant comparisons.
   * 
   * @param functions - Functions with embeddings to compare
   * @param threshold - Minimum similarity score to consider as duplicate
   * @returns Sorted array of duplicate groups (highest similarity first)
   */
  private computeDuplicates(units: IndexUnit[], fallbackThreshold: number): DuplicateGroup[] {
    const duplicates: DuplicateGroup[] = [];
    const byType = new Map<IndexUnitType, IndexUnit[]>();

    for (const unit of units) {
      const list = byType.get(unit.unitType) ?? [];
      list.push(unit);
      byType.set(unit.unitType, list);
    }

    for (const [type, typedUnits] of byType.entries()) {
      const threshold = this.getThreshold(type, fallbackThreshold);

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

  private getThreshold(type: IndexUnitType, fallback: number): number {
    if (type === IndexUnitType.CLASS) return indexConfig.thresholds.class;
    if (type === IndexUnitType.BLOCK) return indexConfig.thresholds.block;
    return indexConfig.thresholds.function ?? fallback;
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
