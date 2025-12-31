import path from "path";
import fs from "fs/promises";
import { DryScanServiceDeps } from "./types";
import { ExclusionService } from "./ExclusionService";
import { IndexUnit } from "../types";
import { addEmbedding } from "../DryScanUpdater";
import { FileEntity } from "../db/entities/FileEntity";
import { IndexUnitExtractor } from "../IndexUnitExtractor";

export interface InitOptions {
  skipEmbeddings?: boolean;
}

export class RepositoryInitializer {
  constructor(
    private readonly deps: DryScanServiceDeps,
    private readonly exclusionService: ExclusionService
  ) {}

  async init(options?: InitOptions): Promise<void> {
    const extractor = this.deps.extractor;

    console.log("[DryScan] Phase 1/4: Extracting code units...");
    await this.initUnits(extractor);
    console.log("[DryScan] Phase 2/4: Resolving internal dependencies...");
    await this.applyDependencies(extractor);
    console.log("[DryScan] Phase 3/4: Computing embeddings (may be slow)...");
    await this.computeEmbeddings(options?.skipEmbeddings === true);
    console.log("[DryScan] Phase 4/4: Tracking files...");
    await this.trackFiles(extractor);
    await this.exclusionService.cleanupExcludedFiles();
    console.log("[DryScan] Initialization phases complete.");
  }

  private async initUnits(extractor: IndexUnitExtractor): Promise<void> {
    const units = await extractor.scan(this.deps.repoPath);
    console.log(`[DryScan] Extracted ${units.length} index units.`);
    await this.deps.db.saveUnits(units);
  }

  private async applyDependencies(extractor: IndexUnitExtractor): Promise<void> {
    const allUnits = await this.deps.db.getAllUnits();
    const updated = await extractor.applyInternalDependencies(allUnits, allUnits);
    await this.deps.db.updateUnits(updated);
  }

  private async computeEmbeddings(skipEmbeddings: boolean): Promise<void> {
    if (skipEmbeddings) {
      console.log("[DryScan] Skipping embedding computation by request.");
      return;
    }
    const allUnits: IndexUnit[] = await this.deps.db.getAllUnits();
    const total = allUnits.length;
    console.log(`[DryScan] Computing embeddings for ${total} units...`);

    const updated: IndexUnit[] = [];
    const progressInterval = Math.max(1, Math.ceil(total / 10));

    for (let i = 0; i < total; i++) {
      const unit = allUnits[i];
      const enriched = await addEmbedding(this.deps.repoPath, unit);
      updated.push(enriched);

      const completed = i + 1;
      if (completed === total || completed % progressInterval === 0) {
        const pct = Math.floor((completed / total) * 100);
        console.log(`[DryScan] Embeddings ${completed}/${total} (${pct}%)`);
      }
    }

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
    console.log(`[DryScan] Tracked ${fileEntities.length} files.`);
  }
}