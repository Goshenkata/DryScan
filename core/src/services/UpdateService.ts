import debug from "debug";
import { DryScanServiceDeps } from "./types";
import { ExclusionService } from "./ExclusionService";
import { performIncrementalUpdate } from "../DryScanUpdater";

const log = debug("DryScan:UpdateService");

export class UpdateService {
  constructor(
    private readonly deps: DryScanServiceDeps,
    private readonly exclusionService: ExclusionService
  ) {}

  async updateIndex(): Promise<void> {
    const config = await this.deps.getConfig();
    const extractor = await this.deps.getExtractor();
    await this.deps.ensureDb();

    try {
      await performIncrementalUpdate(this.deps.repoPath, extractor, this.deps.db, config);
      await this.exclusionService.cleanupExcludedFiles();
    } catch (err) {
      log("Error during index update:", err);
      throw err;
    }
  }
}