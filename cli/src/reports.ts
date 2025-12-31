import { promises as fs } from "fs";
import { join } from "path";
import type { DryConfig, DuplicateReport } from "@dryscan/core";
import { configStore } from "@dryscan/core";

const REPORT_FILE_PREFIX = "dupes-";
const DRYSCAN_DIR = ".dry";
const REPORTS_DIR = "reports";

/**
 * Writes a timestamped report file under .dry/reports and returns its path.
 */
export async function writeDuplicateReport(repoPath: string, report: DuplicateReport): Promise<string> {
  const reportDir = join(repoPath, DRYSCAN_DIR, REPORTS_DIR);
  await fs.mkdir(reportDir, { recursive: true });

  const safeTimestamp = report.generatedAt.replace(/[:.]/g, "-");
  const fileName = `${REPORT_FILE_PREFIX}${safeTimestamp}.json`;
  const filePath = join(reportDir, fileName);
  await fs.writeFile(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

/**
 * Loads the most recently modified report file, returning null when none exist.
 */
export async function loadLatestReport(repoPath: string): Promise<DuplicateReport | null> {
  const reportDir = join(repoPath, DRYSCAN_DIR, REPORTS_DIR);
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
        const fullPath = join(reportDir, name);
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
export async function applyExclusionFromLatestReport(
  repoPath: string,
  shortId: string
): Promise<{ exclusion: string; added: boolean }> {
  const report = await loadLatestReport(repoPath);
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

  await configStore.init(repoPath);
  const config = await configStore.get(repoPath);
  const alreadyPresent = config.excludedPairs.includes(group.exclusionString);
  if (alreadyPresent) {
    return { exclusion: group.exclusionString, added: false };
  }

  const nextConfig: DryConfig = {
    ...config,
    excludedPairs: [...config.excludedPairs, group.exclusionString],
  };

  await configStore.save(repoPath, nextConfig);
  return { exclusion: group.exclusionString, added: true };
}
