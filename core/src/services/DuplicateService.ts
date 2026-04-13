import debug from "debug";
import shortUuid from "short-uuid";
import { DryScanServiceDeps } from "./types";
import { DuplicateAnalysisResult, DuplicateGroup, DuplicateReport, DuplicateServiceMetrics, DuplicationScore, IndexUnit, IndexUnitType, ScanMetrics } from "../types";
import { indexConfig } from "../config/indexConfig";
import { DryConfig } from "../types";
import { DuplicationCache } from "./DuplicationCache";
import { LLMFalsePositiveDetector } from "./LLMFalsePositiveDetector";

const log = debug("DryScan:DuplicateService");

export class DuplicateService {
  private config?: DryConfig;
  private readonly duplicationCache = DuplicationCache.getInstance();

  constructor(private readonly deps: DryScanServiceDeps) {}

  async findDuplicates(
    config: DryConfig,
    dirtyPaths: string[] = [],
    previousReport?: DuplicateReport | null
  ): Promise<DuplicateAnalysisResult> {
    this.config = config;

    const t0 = performance.now();
    const allUnits = await this.deps.db.getAllUnits();
    log("Starting duplicate analysis on %d units", allUnits.length);

    // Build (or incrementally update) the embedding similarity matrix once.
    // Subsequent pairwise comparisons become O(1) lookups.
    this.duplicationCache.clearRunCaches();
    await this.duplicationCache.buildEmbSimCache(allUnits, dirtyPaths);

    if (allUnits.length < 2) {
      return { duplicates: [], score: this.computeDuplicationScore([], allUnits) };
    }

    const thresholds = this.resolveThresholds(config.threshold);
  const dirtySet = new Set(dirtyPaths);
  const canReuseFromReport = Boolean(previousReport && previousReport.threshold === config.threshold);

    const reusableClean = canReuseFromReport
      ? this.reuseCleanPairsFromPreviousReport(previousReport as DuplicateReport, allUnits, dirtySet)
      : [];

    const recomputed = this.computeDuplicates(
      allUnits,
      thresholds,
      canReuseFromReport ? dirtySet : null
    );

    const merged = this.mergeDuplicates(reusableClean, recomputed);
    const filtered = merged.filter((g) => !this.isGroupExcluded(g));

    log(
      "Found %d duplicate groups (%d excluded, %d reused)",
      filtered.length,
      merged.length - filtered.length,
      reusableClean.length
    );

    // LLM false-positive filter (opt-in, default ON via enableLLMFilter config)
    if (config.enableLLMFilter) {
      // Fire-and-forget: evict stale LLM verdicts for files that just changed.
      // The detector's dirtySet check guarantees correctness; this is DB hygiene.
      if (dirtyPaths.length > 0) {
        void this.deps.db.removeLLMVerdictsByFilePaths(dirtyPaths).catch((err) => {
          log("Failed to evict stale LLM verdicts: %s", (err as Error).message);
        });
      }
      const detector = new LLMFalsePositiveDetector(this.deps.repoPath, this.deps.db);
      const llmStart = performance.now();
      const decision = await detector.classify(filtered, dirtyPaths);
      const llmMs = performance.now() - llmStart;
      log(
        "LLM filter: %d true positives, %d false positives",
        decision.truePositives.length,
        decision.falsePositives.length
      );
      const score = this.computeDuplicationScore(decision.truePositives, allUnits);
      log("findDuplicates completed in %dms", (performance.now() - t0).toFixed(2));
      return this.buildResult(decision.truePositives, score, allUnits, filtered.length, Math.round(llmMs));
    }

    const score = this.computeDuplicationScore(filtered, allUnits);
    log("findDuplicates completed in %dms", (performance.now() - t0).toFixed(2));
    return this.buildResult(filtered, score, allUnits, filtered.length, 0);
  }

  private buildResult(
    duplicates: DuplicateGroup[],
    score: DuplicationScore,
    allUnits: IndexUnit[],
    pairsBeforeLLM: number,
    llmFilterMs: number,
  ): DuplicateAnalysisResult {
    return {
      duplicates,
      score,
      metrics: {
        unitCounts: this.countUnitsByType(allUnits),
        pairsBeforeLLM,
        pairsAfterLLM: duplicates.length,
        llmFilterMs,
      },
    };
  }

  private resolveThresholds(functionThreshold?: number): { function: number; block: number; class: number } {
    const d = indexConfig.thresholds;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const fn = clamp(functionThreshold ?? d.function);
    return {
      function: fn,
      block: clamp(fn + d.block - d.function),
      class: clamp(fn + d.class - d.function),
    };
  }

  private computeDuplicates(
    units: IndexUnit[],
    thresholds: { function: number; block: number; class: number },
    dirtySet: Set<string> | null
  ): DuplicateGroup[] {
    if (dirtySet && dirtySet.size === 0) {
      log("Skipping recomputation: no dirty files and previous report threshold matches");
      return [];
    }

    const duplicates: DuplicateGroup[] = [];
    const t0 = performance.now();

    for (const [type, typedUnits] of this.groupByType(units)) {
      const threshold = this.getThreshold(type, thresholds);
      log("Comparing %d %s units (threshold=%.3f)", typedUnits.length, type, threshold);

      for (let i = 0; i < typedUnits.length; i++) {
        for (let j = i + 1; j < typedUnits.length; j++) {
          const left = typedUnits[i];
          const right = typedUnits[j];
          if (this.shouldSkipComparison(left, right)) continue;

          if (dirtySet && !dirtySet.has(left.filePath) && !dirtySet.has(right.filePath)) {
            continue;
          }

          const hasEmbeddings = left.embedding?.length && right.embedding?.length;
          const similarity = hasEmbeddings ? this.computeWeightedSimilarity(left, right, threshold) : 0;
          if (similarity < threshold) continue;

          const exclusionString = this.deps.pairing.pairKeyForUnits(left, right);
          if (!exclusionString) continue;

          duplicates.push({
            id: `${left.id}::${right.id}`,
            similarity,
            shortId: shortUuid.generate(),
            exclusionString,
            left: this.toMember(left),
            right: this.toMember(right),
          });
        }
      }
    }

    log("computeDuplicates: %d duplicates in %dms", duplicates.length, (performance.now() - t0).toFixed(2));
    return duplicates.sort((a, b) => b.similarity - a.similarity);
  }

  private reuseCleanPairsFromPreviousReport(
    report: DuplicateReport,
    units: IndexUnit[],
    dirtySet: Set<string>
  ): DuplicateGroup[] {
    const unitIds = new Set(units.map((u) => u.id));
    const reusable = report.duplicates.filter((group) => {
      const leftDirty = dirtySet.has(group.left.filePath);
      const rightDirty = dirtySet.has(group.right.filePath);
      if (leftDirty || rightDirty) return false;
      return unitIds.has(group.left.id) && unitIds.has(group.right.id);
    });

    log("Reused %d clean-clean duplicate groups from previous report", reusable.length);
    return reusable;
  }

  private mergeDuplicates(reused: DuplicateGroup[], recomputed: DuplicateGroup[]): DuplicateGroup[] {
    const merged = new Map<string, DuplicateGroup>();

    for (const group of reused) {
      merged.set(this.groupKey(group), group);
    }

    for (const group of recomputed) {
      merged.set(this.groupKey(group), group);
    }

    return Array.from(merged.values()).sort((a, b) => b.similarity - a.similarity);
  }

  private groupKey(group: DuplicateGroup): string {
    return [group.left.id, group.right.id].sort().join("::");
  }

  private isGroupExcluded(group: DuplicateGroup): boolean {
    const config = this.config;
    if (!config?.excludedPairs?.length) return false;
    const key = this.deps.pairing.pairKeyForUnits(group.left, group.right);
    if (!key) return false;
    const actual = this.deps.pairing.parsePairKey(key);
    if (!actual) return false;
    return config.excludedPairs.some((entry) => {
      const parsed = this.deps.pairing.parsePairKey(entry);
      return parsed ? this.deps.pairing.pairKeyMatches(actual, parsed) : false;
    });
  }

  private getThreshold(type: IndexUnitType, thresholds: { function: number; block: number; class: number }): number {
    if (type === IndexUnitType.CLASS) return thresholds.class;
    if (type === IndexUnitType.BLOCK) return thresholds.block;
    return thresholds.function;
  }

  private computeWeightedSimilarity(left: IndexUnit, right: IndexUnit, threshold: number): number {
    const selfSim = this.similarity(left, right);

    if (left.unitType === IndexUnitType.CLASS) {
      return selfSim * indexConfig.weights.class.self;
    }

    if (left.unitType === IndexUnitType.FUNCTION) {
      const w = indexConfig.weights.function;
      const hasPC = this.bothHaveParent(left, right, IndexUnitType.CLASS);
      const total = w.self + (hasPC ? w.parentClass : 0);
      if ((w.self * selfSim + (hasPC ? w.parentClass : 0)) / total < threshold) return 0;
      return (w.self * selfSim + (hasPC ? w.parentClass * this.parentSimilarity(left, right, IndexUnitType.CLASS) : 0)) / total;
    }

    const w = indexConfig.weights.block;
    const hasPF = this.bothHaveParent(left, right, IndexUnitType.FUNCTION);
    const hasPC = this.bothHaveParent(left, right, IndexUnitType.CLASS);
    const total = w.self + (hasPF ? w.parentFunction : 0) + (hasPC ? w.parentClass : 0);
    if ((w.self * selfSim + (hasPF ? w.parentFunction : 0) + (hasPC ? w.parentClass : 0)) / total < threshold) return 0;
    return (
      w.self * selfSim +
      (hasPF ? w.parentFunction * this.parentSimilarity(left, right, IndexUnitType.FUNCTION) : 0) +
      (hasPC ? w.parentClass * this.parentSimilarity(left, right, IndexUnitType.CLASS) : 0)
    ) / total;
  }

  private groupByType(units: IndexUnit[]): Map<IndexUnitType, IndexUnit[]> {
    const byType = new Map<IndexUnitType, IndexUnit[]>();
    for (const unit of units) {
      const list = byType.get(unit.unitType) ?? [];
      list.push(unit);
      byType.set(unit.unitType, list);
    }
    return byType;
  }

  private toMember(unit: IndexUnit): DuplicateGroup["left"] {
    return {
      id: unit.id,
      name: unit.name,
      filePath: unit.filePath,
      startLine: unit.startLine,
      endLine: unit.endLine,
      code: unit.code,
      unitType: unit.unitType,
    };
  }

  private bothHaveParent(left: IndexUnit, right: IndexUnit, type: IndexUnitType): boolean {
    return !!this.findParent(left, type) && !!this.findParent(right, type);
  }

  private parentSimilarity(left: IndexUnit, right: IndexUnit, type: IndexUnitType): number {
    const lp = this.findParent(left, type);
    const rp = this.findParent(right, type);
    if (!lp || !rp) return 0;
    return this.similarity(lp, rp);
  }

  private similarity(left: IndexUnit, right: IndexUnit): number {
    if (left.embedding?.length && right.embedding?.length) {
      const sim = this.duplicationCache.getEmbSim(left.id, right.id);
      if (typeof sim === "number") return sim;

      // Enforce matrix-only similarity. If this happens it's a bug in the call flow
      // (e.g. buildEmbSimCache not run with the full set of embedded units).
      throw new Error(
        `Embedding similarity matrix missing for unit pair ${left.id} / ${right.id}. ` +
          `Ensure DuplicationCache.buildEmbSimCache(...) ran before comparisons and included both units.`
      );
    }
    return this.childSimilarity(left, right);
  }

  private childSimilarity(left: IndexUnit, right: IndexUnit): number {
    const lc = left.children ?? [];
    const rc = right.children ?? [];
    if (!lc.length || !rc.length) return 0;

    let best = 0;
    for (const l of lc) {
      for (const r of rc) {
        if (l.unitType !== r.unitType) continue;
        const sim = this.similarity(l, r);
        if (sim > best) best = sim;
      }
    }
    return best;
  }

  private shouldSkipComparison(left: IndexUnit, right: IndexUnit): boolean {
    if (left.unitType !== IndexUnitType.BLOCK || right.unitType !== IndexUnitType.BLOCK) return false;
    if (left.filePath !== right.filePath) return false;
    return (left.startLine <= right.startLine && left.endLine >= right.endLine)
        || (right.startLine <= left.startLine && right.endLine >= left.endLine);
  }

  private findParent(unit: IndexUnit, type: IndexUnitType): IndexUnit | null {
    let p = unit.parent;
    while (p) {
      if (p.unitType === type) return p;
      p = p.parent;
    }
    return null;
  }

  private computeDuplicationScore(duplicates: DuplicateGroup[], allUnits: IndexUnit[]): DuplicationScore {
    const totalLines = allUnits.reduce((sum, u) => sum + u.endLine - u.startLine + 1, 0);

    if (!totalLines || !duplicates.length) {
      return { score: 0, grade: "Excellent", totalLines, duplicateLines: 0, duplicateGroups: 0 };
    }

    const duplicateLines = duplicates.reduce((sum, g) => {
      const avg = ((g.left.endLine - g.left.startLine + 1) + (g.right.endLine - g.right.startLine + 1)) / 2;
      return sum + g.similarity * avg;
    }, 0);

    const score = (duplicateLines / totalLines) * 100;
    return {
      score,
      grade: this.getScoreGrade(score),
      totalLines,
      duplicateLines: Math.round(duplicateLines),
      duplicateGroups: duplicates.length,
    };
  }

  private getScoreGrade(score: number): DuplicationScore["grade"] {
    if (score < 5) return "Excellent";
    if (score < 15) return "Good";
    if (score < 30) return "Fair";
    if (score < 50) return "Poor";
    return "Critical";
  }

  private countUnitsByType(units: IndexUnit[]): ScanMetrics["unitCounts"] {
    let classes = 0, functions = 0, blocks = 0;
    for (const u of units) {
      if (u.unitType === IndexUnitType.CLASS) classes++;
      else if (u.unitType === IndexUnitType.FUNCTION) functions++;
      else if (u.unitType === IndexUnitType.BLOCK) blocks++;
    }
    return { classes, functions, blocks, total: units.length };
  }
}
