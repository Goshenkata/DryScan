import fs from "fs/promises";
import upath from "upath";
import shortUuid from "short-uuid";
import { DuplicateGroup, DuplicationScore } from "../types";
import { DRYSCAN_DIR, REPORTS_DIR } from "../const";
import { DryConfig } from "../types";
import { configStore } from "../config/configStore";
import { PairingService } from "./PairingService";
import { DryScanServiceDeps } from "./types";

export interface DuplicateReport {
  version: number;
  generatedAt: string;
  threshold: number;
  score: DuplicationScore;
  duplicates: DuplicateGroup[];
}

const REPORT_FILE_PREFIX = "dupes-";

export class ReportsService {
  constructor(private readonly deps: DryScanServiceDeps) {}

  /**
   * Creates a report payload with short ids and exclusion strings attached to each group.
   */
  buildDuplicateReport(
    duplicates: DuplicateGroup[],
    threshold: number,
    score: DuplicationScore
  ): DuplicateReport {
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      threshold,
      score,
      duplicates: this.enrichDuplicates(duplicates),
    };
  }

  /**
   * Writes a timestamped report file under .dry/reports and returns its path.
   */
  async writeDuplicateReport(report: DuplicateReport): Promise<string> {
    const reportDir = upath.join(this.deps.repoPath, DRYSCAN_DIR, REPORTS_DIR);
    await fs.mkdir(reportDir, { recursive: true });

    const safeTimestamp = report.generatedAt.replace(/[:.]/g, "-");
    const fileName = `${REPORT_FILE_PREFIX}${safeTimestamp}.json`;
    const filePath = upath.join(reportDir, fileName);
    await fs.writeFile(filePath, JSON.stringify(report, null, 2), "utf8");
    return filePath;
  }

  /**
   * Loads the most recently modified report file, returning null when none exist.
   */
  async loadLatestReport(): Promise<DuplicateReport | null> {
    const reportDir = upath.join(this.deps.repoPath, DRYSCAN_DIR, REPORTS_DIR);
    let entries: string[];
    try {
      entries = await fs.readdir(reportDir);
    } catch (err: any) {
      if (err?.code === "ENOENT") return null;
      throw err;
    }

    const reportFiles = await Promise.all(
      entries
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          const fullPath = upath.join(reportDir, name);
          const stat = await fs.stat(fullPath);
          return { name, fullPath, mtimeMs: stat.mtimeMs };
        })
    );

    if (reportFiles.length === 0) return null;

    reportFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const latest = reportFiles[0];
    const content = await fs.readFile(latest.fullPath, "utf8");
    return JSON.parse(content) as DuplicateReport;
  }

  /**
   * Adds the exclusion for a duplicate group referenced by short id from the latest report.
   */
  async applyExclusionFromLatestReport(shortId: string): Promise<{ exclusion: string; added: boolean }> {
    const report = await this.loadLatestReport();
    if (!report) {
      throw new Error("No duplicate reports found. Run `dryscan dupes` first.");
    }

    const group = report.duplicates.find((d) => d.shortId === shortId);
    if (!group) {
      throw new Error(`No duplicate group found for id ${shortId}.`);
    }

    if (!group.exclusionString) {
      throw new Error("Duplicate group cannot be excluded because it lacks a pair key.");
    }

    const config = await configStore.get(this.deps.repoPath);
    const alreadyPresent = config.excludedPairs.includes(group.exclusionString);
    if (alreadyPresent) {
      return { exclusion: group.exclusionString, added: false };
    }

    const nextConfig: DryConfig = {
      ...config,
      excludedPairs: [...config.excludedPairs, group.exclusionString],
    };

    await configStore.save(this.deps.repoPath, nextConfig);
    return { exclusion: group.exclusionString, added: true };
  }

  private enrichDuplicates(duplicates: DuplicateGroup[]): DuplicateGroup[] {
    return duplicates.map((group) => {
      const exclusionString = group.exclusionString ?? this.pairing().pairKeyForUnits(group.left, group.right);
      return {
        ...group,
        shortId: group.shortId ?? shortUuid.generate(),
        exclusionString,
      };
    });
  }

  private pairing(): PairingService {
    return this.deps.pairing;
  }
}
