import { DryScanDatabase } from "../db/DryScanDatabase";
import { IndexUnitExtractor } from "../IndexUnitExtractor";

export interface DryScanServiceDeps {
  repoPath: string;
  db: DryScanDatabase;
  getExtractor: () => Promise<IndexUnitExtractor>;
  ensureDb: () => Promise<void>;
}