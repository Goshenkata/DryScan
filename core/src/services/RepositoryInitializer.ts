import path from "path";
import fs from "fs/promises";
import debug from "debug";
import { DryScanServiceDeps } from "./types";
import { ExclusionService } from "./ExclusionService";
import { IndexUnit } from "../types";
import { addEmbedding } from "../DryScanUpdater";
import { FileEntity } from "../db/entities/FileEntity";
import { IndexUnitExtractor } from "../IndexUnitExtractor";

const log = debug("DryScan:InitService");

export interface InitOptions {
  skipEmbeddings?: boolean;
}

export class RepositoryInitializer {
  constructor(
    private readonly deps: DryScanServiceDeps,
    private readonly exclusionService: ExclusionService
  ) {}

  async init(options?: InitOptions): Promise<void> {
    const extractor = await this.deps.getExtractor();
    await this.ensureDatabase();

    log("Phase 1: Extracting index units...");
    await this.initUnits(extractor);
    log("Phase 2: Resolving internal dependencies for methods...");
    await this.applyDependencies(extractor);
    log("Phase 3: Computing embeddings for all units...");
    await this.computeEmbeddings(options?.skipEmbeddings === true);
    log("Phase 4: Tracking files...");
    await this.trackFiles(extractor);
    await this.exclusionService.cleanupExcludedFiles();
  }

  private async ensureDatabase(): Promise<void> {
    await this.deps.ensureDb();
  }

  private async initUnits(extractor: IndexUnitExtractor): Promise<void> {
    const units = await extractor.scan(this.deps.repoPath);
    log("Extracted %d index units.", units.length);
    await this.deps.db.saveUnits(units);
  }

  private async applyDependencies(extractor: IndexUnitExtractor): Promise<void> {
    const allUnits = await this.deps.db.getAllUnits();
    const updated = await extractor.applyInternalDependencies(allUnits, allUnits);
    await this.deps.db.updateUnits(updated);
  }

  private async computeEmbeddings(skipEmbeddings: boolean): Promise<void> {
    if (skipEmbeddings) {
      log("Skipping embedding computation by request.");
      return;
    }
    const allUnits: IndexUnit[] = await this.deps.db.getAllUnits();
    log("Computing embeddings for %d units...", allUnits.length);
    const updated: IndexUnit[] = await Promise.all(allUnits.map((unit) => addEmbedding(this.deps.repoPath, unit)));
    await this.deps.db.updateUnits(updated);
  }

  private async trackFiles(extractor: IndexUnitExtractor): Promise<void> {
    const allFunctions = await extractor.listSourceFiles(this.deps.repoPath);
    const fileEntities: FileEntity[] = [];

    for (const relPath of allFunctions) {
      const fullPath = path.join(this.deps.repoPath, relPath);
      const stat = await fs.stat(fullPath);
      const checksum = await extractor.computeChecksum(fullPath);

      const fileEntity = new FileEntity();
      fileEntity.filePath = relPath;
      fileEntity.checksum = checksum;
      fileEntity.mtime = stat.mtimeMs;
      fileEntities.push(fileEntity);
    }

    await this.deps.db.saveFiles(fileEntities);
    log("Tracked %d files.", fileEntities.length);
  }
}