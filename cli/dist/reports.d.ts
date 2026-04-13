import type { DuplicateReport } from "@goshenkata/dryscan-core";
/**
 * Writes a timestamped report file under .dry/reports and returns its path.
 */
export declare function writeDuplicateReport(repoPath: string, report: DuplicateReport): Promise<string>;
/**
 * Loads the most recently modified report file, returning null when none exist.
 */
export declare function loadLatestReport(repoPath: string): Promise<DuplicateReport | null>;
/**
 * Adds the exclusion for a duplicate group referenced by short id from the latest report.
 */
export declare function applyExclusionFromLatestReport(repoPath: string, shortId: string): Promise<{
    exclusion: string;
    added: boolean;
}>;
//# sourceMappingURL=reports.d.ts.map