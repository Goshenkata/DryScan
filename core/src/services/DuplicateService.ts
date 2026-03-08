import debug from "debug";
import shortUuid from "short-uuid";
import { DryScanServiceDeps } from "./types";
import { DuplicateAnalysisResult, DuplicateGroup, DuplicationScore, IndexUnit, IndexUnitType } from "../types";
import { indexConfig } from "../config/indexConfig";
import { DryConfig } from "../types";
import { DuplicationCache } from "./DuplicationCache";

const log = debug("DryScan:DuplicateService");

export class DuplicateService {
  private config?: DryConfig;
  private readonly cache = DuplicationCache.getInstance();

  constructor(private readonly deps: DryScanServiceDeps) {}

  async findDuplicates(config: DryConfig): Promise<DuplicateAnalysisResult> {
    this.config = config;
    const t0 = performance.now();
    const allUnits = await this.deps.db.getAllUnits();
    log("Starting duplicate analysis on %d units", allUnits.length);

    if (allUnits.length < 2) {
      return { duplicates: [], score: this.computeDuplicationScore([], allUnits) };
    }

    const thresholds = this.resolveThresholds(config.threshold);
    const duplicates = this.computeDuplicates(allUnits, thresholds);
    const filtered = duplicates.filter((g) => !this.isGroupExcluded(g));
    log("Found %d duplicate groups (%d excluded)", filtered.length, duplicates.length - filtered.length);

    this.cache.update(filtered).catch((err) => log("Cache update failed: %O", err));

    const score = this.computeDuplicationScore(filtered, allUnits);
    log("findDuplicates completed in %dms", (performance.now() - t0).toFixed(2));
    return { duplicates: filtered, score };
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
    thresholds: { function: number; block: number; class: number }
  ): DuplicateGroup[] {
    this.cache.clearRunCaches();
    this.cache.buildEmbSimCache(units);

    const duplicates: DuplicateGroup[] = [];
    const t0 = performance.now();

    for (const [type, typedUnits] of this.groupEmbeddedByType(units)) {
      const threshold = this.getThreshold(type, thresholds);
      log("Comparing %d %s units (threshold=%.3f)", typedUnits.length, type, threshold);

      for (let i = 0; i < typedUnits.length; i++) {
        for (let j = i + 1; j < typedUnits.length; j++) {
          const left = typedUnits[i], right = typedUnits[j];
          if (this.shouldSkipComparison(left, right)) continue;

          const similarity = this.cache.get(left.id, right.id, left.filePath, right.filePath)
            ?? this.computeWeightedSimilarity(left, right, threshold);
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

    //CLASS
    if (left.unitType === IndexUnitType.CLASS) {
      return selfSim * indexConfig.weights.class.self;
    }

    // FUNCTION
    if (left.unitType === IndexUnitType.FUNCTION) {
      const w = indexConfig.weights.function;
      const hasPC = this.bothHaveParent(left, right, IndexUnitType.CLASS);
      const total = w.self + (hasPC ? w.parentClass : 0);
      // Early exit: even with perfect parent similarity, can't reach threshold.
      if ((w.self * selfSim + (hasPC ? w.parentClass : 0)) / total < threshold) return 0;
      return (w.self * selfSim + (hasPC ? w.parentClass * this.parentSimilarity(left, right, IndexUnitType.CLASS) : 0)) / total;
    }

    // BLOCK
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

  /** Groups units that have embeddings by type — single filter point for the comparison loop. */
  private groupEmbeddedByType(units: IndexUnit[]): Map<IndexUnitType, IndexUnit[]> {
    const byType = new Map<IndexUnitType, IndexUnit[]>();
    for (const unit of units) {
      if (!unit.embedding?.length) continue;
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
    const lp = this.findParent(left, type), rp = this.findParent(right, type);
    if (!lp || !rp) return 0;

    const key = lp.id < rp.id ? `${lp.id}::${rp.id}` : `${rp.id}::${lp.id}`;
    const cached = this.cache.getParentSim(key);
    if (cached !== undefined) return cached;

    const sim = this.similarity(lp, rp);
    this.cache.setParentSim(key, sim);
    return sim;
  }

  /** Resolves similarity via the pre-computed embedding matrix, falling back to best child match. */
  private similarity(left: IndexUnit, right: IndexUnit): number {
    return this.cache.getEmbSim(left.id, right.id) ?? this.childSimilarity(left, right);
  }

  private childSimilarity(left: IndexUnit, right: IndexUnit): number {
    const lc = left.children ?? [], rc = right.children ?? [];
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
}