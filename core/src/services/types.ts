import { DryConfig } from "../config/dryconfig";
import { DryScanDatabase } from "../db/DryScanDatabase";
import { IndexUnitExtractor } from "../IndexUnitExtractor";

export interface DryScanServiceDeps {
  repoPath: string;
  db: DryScanDatabase;
  getConfig: () => Promise<DryConfig>;
  getExtractor: () => Promise<IndexUnitExtractor>;
  ensureDb: () => Promise<void>;
  setConfig: (config: DryConfig) => void;
}