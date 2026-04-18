import debug from "debug";
import { DuplicateGroup, LLMDecision } from "../types";
import { DryScanDatabase } from "../db/DryScanDatabase";
import { LLMVerdictEntity } from "../db/entities/LLMVerdictEntity";
import { ModelConnector } from "./ModelConnector";
import { configStore } from "../config/configStore";

const log = debug("DryScan:LLMFalsePositiveDetector");

/**
 * Maximum number of LLM classification requests dispatched in parallel per batch.
 */
const CONCURRENCY_LIMIT = 20;

/**
 * Classifies embedding-confirmed duplicate candidates via an LLM
 * to separate true duplicates from false positives.
 *
 * The backend is selected via dryconfig.json `llmSource`:
 * - "copilot" → GPT-4.1 via the copilot CLI
 * - anything else → Ollama chat model specified by `llmModel`
 *
 * Verdicts are persisted in the `llm_verdicts` table and reused on subsequent
 * runs as long as neither file in the pair has changed (dirty-path invalidation
 * is handled by the caller before invoking `classify`).
 */
export class LLMFalsePositiveDetector {
  private readonly connector: ModelConnector;

  constructor(
    private readonly repoPath: string,
    private readonly db: DryScanDatabase
  ) {
    this.connector = new ModelConnector(repoPath);
  }

  /**
   * Classifies `candidates` as true positives or false positives.
   *
   * Cache behaviour:
   * - Pairs where NEITHER file is in `dirtyPaths` and a cached verdict exists → reuse.
   * - All other pairs → call the LLM and persist the new verdict.
   */
  async classify(candidates: DuplicateGroup[], dirtyPaths: string[]): Promise<LLMDecision> {
    if (candidates.length === 0) {
      return { truePositives: [], falsePositives: [] };
    }

    const dirtySet = new Set(dirtyPaths);
    const pairKeys = candidates.map((g) => this.pairKey(g));

    const cached = await this.db.getLLMVerdicts(pairKeys);
    const verdictMap = new Map(cached.map((v) => [v.pairKey, v.verdict]));

    const toClassify = candidates.filter((g) => {
      if (dirtySet.has(g.left.filePath) || dirtySet.has(g.right.filePath)) return true;
      return !verdictMap.has(this.pairKey(g));
    });

    log(
      "%d candidates: %d from cache, %d need classification",
      candidates.length,
      candidates.length - toClassify.length,
      toClassify.length
    );

    if (toClassify.length > 0) {
      const newVerdicts = await this.classifyWithConcurrency(toClassify);
      const entities: LLMVerdictEntity[] = newVerdicts.map(({ group, verdict }) =>
        Object.assign(new LLMVerdictEntity(), {
          pairKey: this.pairKey(group),
          verdict,
          leftFilePath: group.left.filePath,
          rightFilePath: group.right.filePath,
          createdAt: Date.now(),
        })
      );
      await this.db.saveLLMVerdicts(entities);
      for (const { group, verdict } of newVerdicts) {
        verdictMap.set(this.pairKey(group), verdict);
      }
    }

    const truePositives: DuplicateGroup[] = [];
    const falsePositives: DuplicateGroup[] = [];

    for (const group of candidates) {
      if (verdictMap.get(this.pairKey(group)) === "no") {
        falsePositives.push(group);
      } else {
        // "yes", unknown, or error fallback → keep as true positive
        truePositives.push(group);
      }
    }

    log("%d true positives, %d false positives", truePositives.length, falsePositives.length);
    return { truePositives, falsePositives };
  }

  /** Stable, order-independent pair key matching DuplicateService.groupKey. */
  pairKey(group: DuplicateGroup): string {
    return [group.left.id, group.right.id].sort().join("::");
  }

  private async classifyWithConcurrency(
    groups: DuplicateGroup[]
  ): Promise<Array<{ group: DuplicateGroup; verdict: "yes" | "no" }>> {
    const results: Array<{ group: DuplicateGroup; verdict: "yes" | "no" }> = [];
    for (let i = 0; i < groups.length; i += CONCURRENCY_LIMIT) {
      const batch = groups.slice(i, i + CONCURRENCY_LIMIT);
      const batchResults = await Promise.all(batch.map((g) => this.classifyPair(g)));
      results.push(...batchResults);
    }
    return results;
  }

  private async classifyPair(
    group: DuplicateGroup
  ): Promise<{ group: DuplicateGroup; verdict: "yes" | "no" }> {
    try {
      const config = await configStore.get(this.repoPath);
      const snippetA = this.formatSnippet(group.left);
      const snippetB = this.formatSnippet(group.right);
      let verdict: "yes" | "no";
      if (config.llmSource === "copilot") {
        verdict = await this.connector.classifyWithCopilot(snippetA, snippetB);
      } else {
        verdict = await this.connector.chatClassify(snippetA, snippetB);
      }
      log("Pair %s → %s", this.pairKey(group), verdict);
      return { group, verdict };
    } catch (err) {
      log("Classifier error for pair %s: %s — defaulting to true positive", this.pairKey(group), (err as Error).message);
      return { group, verdict: "yes" };
    }
  }

  private formatSnippet(side: DuplicateGroup["left"]): string {
    return [
      `name: ${side.name}`,
      `type: ${side.unitType}`,
      `file: ${side.filePath} lines ${side.startLine}-${side.endLine}`,
      side.code,
    ].join("\n");
  }
}
