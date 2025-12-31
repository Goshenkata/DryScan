import { DryScanDatabase } from "../db/DryScanDatabase";
import { IndexUnitExtractor } from "../IndexUnitExtractor";
import { PairingService } from "./PairingService";

export interface DryScanServiceDeps {
  repoPath: string;
  db: DryScanDatabase;
  extractor: IndexUnitExtractor;
  pairing: PairingService;
}