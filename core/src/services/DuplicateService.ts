import debug from "debug";
import shortUuid from "short-uuid";
import { cosineSimilarity } from "@langchain/core/utils/math";
import { DryScanServiceDeps } from "./types";
import { DuplicateAnalysisResult, DuplicateGroup, DuplicationScore, IndexUnit, IndexUnitType } from "../types";
import { indexConfig } from "../config/indexConfig";
import { pairKeyForUnits, parsePairKey, pairKeyMatches } from "../pairs";
import { configStore } from "../config/configStore";
import { DryConfig } from "../config/dryconfig";

const log = debug("DryScan:DuplicateService");

export class DuplicateService {
  private config?: DryConfig;

  constructor(private readonly deps: DryScanServiceDeps) {}

  async findDuplicates(): Promise<DuplicateAnalysisResult> {
    this.config = await configStore.get(this.deps.repoPath);
    const config = this.config;
    const allUnits = await this.deps.db.getAllUnits();
    const unitsWithEmbeddings = allUnits.filter((unit) => unit.embedding && unit.embedding.length > 0);

    if (unitsWithEmbeddings.length < 2) {
      const score = this.computeDuplicationScore([], allUnits);
      return { duplicates: [], score };
    }

  const thresholds = this.resolveThresholds(config.threshold);
    const duplicates = this.computeDuplicates(unitsWithEmbeddings, thresholds);
  const filteredDuplicates = duplicates.filter((group) => !this.isGroupExcluded(group));
    log("Found %d duplicate groups", filteredDuplicates.length);

    const score = this.computeDuplicationScore(filteredDuplicates, allUnits);
    return { duplicates: filteredDuplicates, score };
  }

  private resolveThresholds(functionThreshold?: number): { function: number; block: number; class: number } {
    const defaults = indexConfig.thresholds;
    const clamp = (value: number) => Math.min(1, Math.max(0, value));

    const base = functionThreshold ?? defaults.function;
    const blockOffset = defaults.block - defaults.function;
    const classOffset = defaults.class - defaults.function;

    const functionThresholdValue = clamp(base);
    return {
      function: functionThresholdValue,
      block: clamp(functionThresholdValue + blockOffset),
      class: clamp(functionThresholdValue + classOffset),
    };
  }

  private computeDuplicates(
    units: IndexUnit[],
    thresholds: { function: number; block: number; class: number }
  ): DuplicateGroup[] {
    const duplicates: DuplicateGroup[] = [];
    const byType = new Map<IndexUnitType, IndexUnit[]>();

    for (const unit of units) {
      const list = byType.get(unit.unitType) ?? [];
      list.push(unit);
      byType.set(unit.unitType, list);
    }

    for (const [type, typedUnits] of byType.entries()) {
      const threshold = this.getThreshold(type, thresholds);

      for (let i = 0; i < typedUnits.length; i++) {
        for (let j = i + 1; j < typedUnits.length; j++) {
          const left = typedUnits[i];
          const right = typedUnits[j];

          if (!left.embedding || !right.embedding) continue;

          const similarity = this.computeWeightedSimilarity(left, right);
          if (similarity >= threshold) {
            duplicates.push({
              id: `${left.id}::${right.id}`,
              similarity,
              shortId: shortUuid.generate(),
              exclusionString: pairKeyForUnits(left, right),
              left: {
                name: left.name,
                filePath: left.filePath,
                startLine: left.startLine,
                endLine: left.endLine,
                code: left.code,
                unitType: left.unitType,
              },
              right: {
                name: right.name,
                filePath: right.filePath,
                startLine: right.startLine,
                endLine: right.endLine,
                code: right.code,
                unitType: right.unitType,
              },
            });
          }
        }
      }
    }

    return duplicates.sort((a, b) => b.similarity - a.similarity);
  }

  private isGroupExcluded(group: DuplicateGroup): boolean {
    const config = this.config;
    if (!config || !config.excludedPairs || config.excludedPairs.length === 0) return false;
    const key = pairKeyForUnits(group.left, group.right);
    if (!key) return false;
    const actual = parsePairKey(key);
    if (!actual) return false;
    return config.excludedPairs.some((entry) => {
      const parsed = parsePairKey(entry);
      return parsed ? pairKeyMatches(actual, parsed) : false;
    });
  }

  private getThreshold(type: IndexUnitType, thresholds: { function: number; block: number; class: number }): number {
    if (type === IndexUnitType.CLASS) return thresholds.class;
    if (type === IndexUnitType.BLOCK) return thresholds.block;
    return thresholds.function;
  }

  private computeWeightedSimilarity(left: IndexUnit, right: IndexUnit): number {
    if (!left.embedding || !right.embedding) return 0;

    const selfSimilarity = cosineSimilarity([left.embedding], [right.embedding])[0][0];

    if (left.unitType === IndexUnitType.CLASS) {
      return selfSimilarity * indexConfig.weights.class.self;
    }

    if (left.unitType === IndexUnitType.FUNCTION) {
      const parentClassSimilarity = this.parentSimilarity(left, right, IndexUnitType.CLASS);
      const weights = indexConfig.weights.function;
      return (weights.self * selfSimilarity) + (weights.parentClass * parentClassSimilarity);
    }

    const weights = indexConfig.weights.block;
    const parentFuncSim = this.parentSimilarity(left, right, IndexUnitType.FUNCTION);
    const parentClassSim = this.parentSimilarity(left, right, IndexUnitType.CLASS);
    return (
      weights.self * selfSimilarity +
      weights.parentFunction * parentFuncSim +
      weights.parentClass * parentClassSim
    );
  }

  private parentSimilarity(left: IndexUnit, right: IndexUnit, targetType: IndexUnitType): number {
    const leftParent = this.findParentOfType(left, targetType);
    const rightParent = this.findParentOfType(right, targetType);
    if (!leftParent || !rightParent || !leftParent.embedding || !rightParent.embedding) return 0;
    return cosineSimilarity([leftParent.embedding], [rightParent.embedding])[0][0];
  }

  private findParentOfType(unit: IndexUnit, targetType: IndexUnitType): IndexUnit | null {
    let current: IndexUnit | undefined | null = unit.parent;
    while (current) {
      if (current.unitType === targetType) return current;
      current = current.parent;
    }
    return null;
  }

  private computeDuplicationScore(duplicates: DuplicateGroup[], allUnits: IndexUnit[]): DuplicationScore {
    const totalLines = this.calculateTotalLines(allUnits);

    if (totalLines === 0 || duplicates.length === 0) {
      return {
        score: 0,
        grade: "Excellent",
        totalLines,
        duplicateLines: 0,
        duplicateGroups: 0,
      };
    }

    const weightedDuplicateLines = duplicates.reduce((sum, group) => {
      const leftLines = group.left.endLine - group.left.startLine + 1;
      const rightLines = group.right.endLine - group.right.startLine + 1;
      const avgLines = (leftLines + rightLines) / 2;
      return sum + group.similarity * avgLines;
    }, 0);

    const score = (weightedDuplicateLines / totalLines) * 100;
    const grade = this.getScoreGrade(score);

    return {
      score,
      grade,
      totalLines,
      duplicateLines: Math.round(weightedDuplicateLines),
      duplicateGroups: duplicates.length,
    };
  }

  private calculateTotalLines(units: IndexUnit[]): number {
    return units.reduce((sum, unit) => {
      const lines = unit.endLine - unit.startLine + 1;
      return sum + lines;
    }, 0);
  }

  private getScoreGrade(score: number): DuplicationScore["grade"] {
    if (score < 5) return "Excellent";
    if (score < 15) return "Good";
    if (score < 30) return "Fair";
    if (score < 50) return "Poor";
    return "Critical";
  }
}