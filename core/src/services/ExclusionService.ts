import { DryConfig, saveDryConfig } from "../config/dryconfig";
import { DryScanServiceDeps } from "./types";
import { IndexUnitType } from "../types";
import { pairKeyForUnits, parsePairKey, pairKeyMatches, ParsedPairKey } from "../pairs";
import { minimatch } from "minimatch";

export class ExclusionService {
  constructor(private readonly deps: DryScanServiceDeps) {}

  async cleanupExcludedFiles(): Promise<void> {
    const config = this.deps.config;
    if (!config.excludedPaths || config.excludedPaths.length === 0) return;

    const units = await this.deps.db.getAllUnits();
    const files = await this.deps.db.getAllFiles();

    const unitPathsToRemove = new Set<string>();
    for (const unit of units) {
      if (this.pathExcluded(unit.filePath, config)) {
        unitPathsToRemove.add(unit.filePath);
      }
    }

    const filePathsToRemove = new Set<string>();
    for (const file of files) {
      if (this.pathExcluded(file.filePath, config)) {
        filePathsToRemove.add(file.filePath);
      }
    }

    const paths = [...new Set([...unitPathsToRemove, ...filePathsToRemove])];
    if (paths.length > 0) {
      await this.deps.db.removeUnitsByFilePaths(paths);
      await this.deps.db.removeFilesByFilePaths(paths);
    }
  }

  async cleanExclusions(): Promise<{ removed: number; kept: number }> {
    const config = this.deps.config;
    await this.deps.ensureDb();
    const units = await this.deps.db.getAllUnits();

    const actualPairsByType = {
      [IndexUnitType.CLASS]: this.buildPairKeys(units, IndexUnitType.CLASS),
      [IndexUnitType.FUNCTION]: this.buildPairKeys(units, IndexUnitType.FUNCTION),
      [IndexUnitType.BLOCK]: this.buildPairKeys(units, IndexUnitType.BLOCK),
    };

    const kept: string[] = [];
    const removed: string[] = [];

    for (const entry of config.excludedPairs || []) {
      const parsed = parsePairKey(entry);
      if (!parsed) {
        removed.push(entry);
        continue;
      }

      const candidates = actualPairsByType[parsed.type];
      const matched = candidates.some((actual) => pairKeyMatches(actual, parsed));
      if (matched) {
        kept.push(entry);
      } else {
        removed.push(entry);
      }
    }

    const nextConfig: DryConfig = { ...config, excludedPairs: kept };
    await saveDryConfig(this.deps.repoPath, nextConfig);
    this.deps.config = nextConfig;

    return { removed: removed.length, kept: kept.length };
  }

  private pathExcluded(filePath: string, config: DryConfig): boolean {
    if (!config.excludedPaths || config.excludedPaths.length === 0) return false;
    return config.excludedPaths.some((pattern) => minimatch(filePath, pattern, { dot: true }));
  }

  private buildPairKeys(units: any[], type: IndexUnitType): ParsedPairKey[] {
    const typed = units.filter((u) => u.unitType === type);
    const pairs: ParsedPairKey[] = [];
    for (let i = 0; i < typed.length; i++) {
      for (let j = i + 1; j < typed.length; j++) {
        const key = pairKeyForUnits(typed[i], typed[j]);
        const parsed = key ? parsePairKey(key) : null;
        if (parsed) {
          pairs.push(parsed);
        }
      }
    }
    return pairs;
  }
}