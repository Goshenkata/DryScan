import { DryConfig } from "../config/dryconfig";
import { DryScanDatabase } from "../db/DryScanDatabase";
import { IndexUnitExtractor } from "../IndexUnitExtractor";

export interface DryScanServiceDeps {
  repoPath: string;
  db: DryScanDatabase;
  config: DryConfig;
  getExtractor: () => Promise<IndexUnitExtractor>;
  ensureDb: () => Promise<void>;
}