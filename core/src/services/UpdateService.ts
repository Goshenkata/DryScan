import debug from "debug";
import { DryScanServiceDeps } from "./types";
import { ExclusionService } from "./ExclusionService";
import { performIncrementalUpdate } from "../DryScanUpdater";
import { DuplicationCache } from "./DuplicationCache";

const log = debug("DryScan:UpdateService");

export class UpdateService {
  constructor(
    private readonly deps: DryScanServiceDeps,
    private readonly exclusionService: ExclusionService
  ) {}

  /** Returns the list of file paths that were modified or deleted (dirty). */
  async updateIndex(): Promise<string[]> {
    const extractor = this.deps.extractor;
    const cache = DuplicationCache.getInstance();

    try {
      const changeSet = await performIncrementalUpdate(this.deps.repoPath, extractor, this.deps.db);
      await this.exclusionService.cleanupExcludedFiles();
      const dirtyPaths = [...changeSet.changed, ...changeSet.deleted, ...changeSet.added];
      await cache.invalidate(dirtyPaths);
      return dirtyPaths;
    } catch (err) {
      log("Error during index update:", err);
      throw err;
    }
  }
}