import upath from "upath";
import fs from "fs/promises";
import { DuplicateGroup, EmbeddingResult, FunctionInfo } from "./types.js";
import { DRYSCAN_DIR, INDEX_DB } from "./const.js";
import { defaultExtractors, FunctionExtractor } from "./FunctionExtractor.js";
import { DryScanDatabase } from "./db/DryScanDatabase.js";
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
  async init(): Promise<void> {
    if (await this.isInitialized()) return;
    const dbPath = upath.join(this.repoPath, DRYSCAN_DIR, INDEX_DB);
    await fs.mkdir(upath.dirname(dbPath), { recursive: true });
    await this.db.init(dbPath);

    // Phase 1: Extract all functions without dependencies
    await this.initFunctions();
    // Phase 2: Resolve internal function calls
    await this.applyDependencies();
    // Phase 3: Generate embeddings for similarity detection
    await this.computeEmbeddings();
  }

  /**
   * Phase 1: Scans repository and extracts all functions.
   * Saves functions to DB with internalFunctions undefined.
   */
  private async initFunctions(): Promise<void> {
    const functions = await this.functionExtractor.scan(this.repoPath);
    await this.db.saveFunctions(functions);
  }

  /**
   * Phase 2: Resolves internal dependencies for all functions.
   * Loads all functions, applies dependency resolution, and saves back.
   */
  private async applyDependencies(): Promise<void> {
    const allFunctions = await this.db.getAllFunctions();
    const updated = await this.functionExtractor.applyInternalDependencies(allFunctions, allFunctions);
    await this.db.updateFunctions(updated);
  }

  /**
   * Phase 3: Computes semantic embeddings for duplicate detection.
   * TODO: Implement embedding computation
   */
  private async computeEmbeddings(): Promise<void> {
    // TODO: Implement embedding computation
  }
  

  async findDuplicates(): Promise<DuplicateGroup[]> {
    return [];
  }

  private async isInitialized(): Promise<boolean> {
    const indexPath = upath.join(this.repoPath, DRYSCAN_DIR, INDEX_DB);
    try {
      const stat = await fs.stat(indexPath);
      return stat.isFile();
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }
}