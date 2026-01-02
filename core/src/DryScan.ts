import upath from "upath";
import fs from "fs/promises";
import { DuplicateAnalysisResult, DuplicateReport } from "./types";
import { DRYSCAN_DIR, INDEX_DB } from "./const";
import { defaultExtractors, IndexUnitExtractor } from "./IndexUnitExtractor";
import { DryScanDatabase } from "./db/DryScanDatabase";
import { RepositoryInitializer, InitOptions as InitServiceOptions } from "./services/RepositoryInitializer";
import { UpdateService } from "./services/UpdateService";
import { DuplicateService } from "./services/DuplicateService";
import { ExclusionService } from "./services/ExclusionService";
import { DryScanServiceDeps } from "./services/types";
import { configStore } from "./config/configStore";
import { DryConfig } from "./types";
import { PairingService } from "./services/PairingService";

export type InitOptions = InitServiceOptions;


export class DryScan {
  repoPath: string;
  private readonly extractor: IndexUnitExtractor;
  private db: DryScanDatabase;
  private readonly services: {
    initializer: RepositoryInitializer;
    updater: UpdateService;
    duplicate: DuplicateService;
    exclusion: ExclusionService;
  };
  private readonly serviceDeps: DryScanServiceDeps;

  constructor(
    repoPath: string,
    extractor?: IndexUnitExtractor,
    db?: DryScanDatabase
  ) {
    this.repoPath = repoPath;
    this.extractor = extractor ?? new IndexUnitExtractor(repoPath, defaultExtractors(repoPath));
    this.db = db ?? new DryScanDatabase();

    this.serviceDeps = {
      repoPath: this.repoPath,
      db: this.db,
      extractor: this.extractor,
      pairing: new PairingService(this.extractor),
    };

    const exclusion = new ExclusionService(this.serviceDeps);
    this.services = {
      initializer: new RepositoryInitializer(this.serviceDeps, exclusion),
      updater: new UpdateService(this.serviceDeps, exclusion),
      duplicate: new DuplicateService(this.serviceDeps),
      exclusion,
    };
  }

  /**
   * Initializes the DryScan repository with a 3-phase analysis:
   * Phase 1: Extract and save all functions
   * Phase 2: Resolve and save internal dependencies
   * Phase 3: Compute and save semantic embeddings
   */
  async init(options?: InitOptions): Promise<void> {
    console.log(`[DryScan] Initializing repository at ${this.repoPath}`);
    console.log("[DryScan] Preparing database and cache...");
    await configStore.init(this.repoPath);
    await this.ensureDatabase();
    if (await this.isInitialized()) {
      console.log("[DryScan] Repository already initialized; skipping full init.");
      return;
    }
    console.log("[DryScan] Starting initial scan (may take a moment)...");
    await this.services.initializer.init(options);
    console.log("[DryScan] Initial scan complete.");
  }

  /**
   * Updates the index by detecting changed, new, and deleted files.
   * Only reprocesses units in changed files for efficiency.
   * Delegates to DryScanUpdater module for implementation.
   * 
   * Update process:
   * 1. List all current source files in repository
   * 2. For each file, check if it's new, changed, or unchanged (via mtime + checksum)
   * 3. Remove old units from changed/deleted files
   * 4. Extract and save units from new/changed files
   * 5. Recompute internal dependencies for affected units
   * 6. Recompute embeddings for affected units
   * 7. Update file tracking metadata
   */
  async updateIndex(): Promise<void> {
    console.log(`[DryScan] Updating index at ${this.repoPath}...`);
    console.log("[DryScan] Checking for file changes...");
    const start = Date.now();
    await this.ensureDatabase();
    await this.services.updater.updateIndex();
    const duration = Date.now() - start;
    console.log(`[DryScan] Index update complete. Took ${duration}ms.`);
  }


  /**
   * Runs duplicate detection and returns a normalized report payload ready for persistence or display.
   */
  async buildDuplicateReport(): Promise<DuplicateReport> {
    const config = await this.loadConfig();
    const analysis = await this.findDuplicates(config);
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      threshold: config.threshold,
      grade: analysis.score.grade,
      score: analysis.score,
      duplicates: analysis.duplicates,
    };
  }

  /**
   * Finds duplicate code blocks using cosine similarity on embeddings.
   * Automatically updates the index before searching to ensure results are current.
   * Compares all function pairs and returns groups with similarity above the configured threshold.
   *
   * @returns Analysis result with duplicate groups and duplication score
   */
  private async findDuplicates(config: DryConfig): Promise<DuplicateAnalysisResult> {
    console.log(`[DryScan] Finding duplicates (threshold: ${config.threshold})...`);
    await this.ensureDatabase();

    console.log("[DryScan] Updating index...");
    const updateStart = Date.now();
    await this.updateIndex();
    const updateDuration = Date.now() - updateStart;
    console.log(`[DryScan] Index update  took ${updateDuration}ms.`);

    console.log("[DryScan] Detecting duplicates...");
    const dupStart = Date.now();
    const result = await this.services.duplicate.findDuplicates(config);
    const dupDuration = Date.now() - dupStart;
    console.log(`[DryScan] Duplicate detection took ${dupDuration}ms.`);

    return result;
  }

  /**
   * Cleans excludedPairs entries that no longer match any indexed units.
   * Runs an update first to ensure the index reflects current code.
   */
  async cleanExclusions(): Promise<{ removed: number; kept: number }> {
    await this.updateIndex();
    return this.services.exclusion.cleanExclusions();
  }

  private async ensureDatabase(): Promise<void> {
    if (this.db.isInitialized()) return;
    const dbPath = upath.join(this.repoPath, DRYSCAN_DIR, INDEX_DB);
    await fs.mkdir(upath.dirname(dbPath), { recursive: true });
    await this.db.init(dbPath);
  }

  private async loadConfig(): Promise<DryConfig> {
    return configStore.get(this.repoPath);
  }

  private async isInitialized(): Promise<boolean> {
    if (!this.db.isInitialized()) return false;
    const unitCount = await this.db.countUnits();
    const initialized = unitCount > 0;
    console.log(`[DryScan] Initialization check: ${unitCount} indexed units`);
    return initialized;
  }
}
