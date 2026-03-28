import fs from "fs/promises";
import path from "path";
import debug from "debug";
import { DuplicateGroup, LLMDecision } from "../types";
import { DryScanDatabase } from "../db/DryScanDatabase";
import { LLMVerdictEntity } from "../db/entities/LLMVerdictEntity";
import { ModelConnector } from "./ModelConnector";

const log = debug("DryScan:LLMFalsePositiveDetector");

/**
 * Maximum number of LLM classification requests dispatched in parallel per batch.
 */
const CONCURRENCY_LIMIT = 20;

/**
 * Classifies embedding-confirmed duplicate candidates via a fine-tuned LLM
 * (qwen-duplication-2b, served by Ollama) to separate true duplicates from false positives.
 *
 * Verdicts are persisted in the `llm_verdicts` table and reused on subsequent
 * runs as long as neither file in the pair has changed (dirty-path invalidation
 * is handled by the caller before invoking `classify`).
 *
 * NOTE: Language detection is hardcoded to Java until additional LanguageExtractor
 * implementations are added to the pipeline.
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
      const prompt = await this.buildPrompt(group);
      const raw = await this.connector.chat(prompt);
      const verdict: "yes" | "no" = raw.toLowerCase().startsWith("yes") ? "yes" : "no";
      log("Pair %s → %s (raw: %s)", this.pairKey(group), verdict, raw);
      return { group, verdict };
    } catch (err) {
      log("LLM classification error for pair %s: %s — defaulting to true positive", this.pairKey(group), (err as Error).message);
      return { group, verdict: "yes" };
    }
  }

  /**
   * Builds the inference prompt matching the training format documented in
   * DryScanDiplomna/finetune/TRAINING_FORMAT.md.
   *
   * TODO: detect language from file extension once more LanguageExtractors are added.
   *       Currently hardcoded to "java".
   */
  private async buildPrompt(group: DuplicateGroup): Promise<string> {
    const projectName = path.basename(this.repoPath);
    // Language is hardcoded to java — the only extractor currently implemented.
    const lang = "java";

    const [fileAContent, fileBContent] = await Promise.all([
      fs.readFile(path.join(this.repoPath, group.left.filePath), "utf8").catch(() => ""),
      fs.readFile(path.join(this.repoPath, group.right.filePath), "utf8").catch(() => ""),
    ]);

    const lines = [
      "You are a strict code-duplication judge.",
      "",
      "Task:",
      "Decide if Snippet A and Snippet B count as duplicated code.",
      "Answer based on BOTH the snippets and their full-file context.",
      "",
      "Definition (return 'yes' if ANY apply):",
      "- Straight/near clone (small edits, renames, reformatting).",
      "- Semantic duplicate: different syntax but same behavior/intent.",
      "- Extractable duplicate: not identical, but a reasonable shared helper/abstraction could be extracted.",
      "Return 'no' ONLY if they clearly implement different responsibilities/logic and are not reasonably extractable.",
      "",
      "Output rules (mandatory):",
      "- Output EXACTLY one token: yes OR no",
      "- No punctuation, no extra words, no explanations",
      "- Think silently before answering",
      "",
      "Evidence:",
      "",
      `=== Snippet A (project=${projectName} id=${group.left.id}) ===`,
      `name: ${group.left.name}`,
      `unitType: ${group.left.unitType}`,
      `filePath: ${group.left.filePath}`,
      `lines: ${group.left.startLine}-${group.left.endLine}`,
      "```" + lang,
      group.left.code,
      "```",
      "",
      `=== Snippet B (project=${projectName} id=${group.right.id}) ===`,
      `name: ${group.right.name}`,
      `unitType: ${group.right.unitType}`,
      `filePath: ${group.right.filePath}`,
      `lines: ${group.right.startLine}-${group.right.endLine}`,
      "```" + lang,
      group.right.code,
      "```",
      "",
      `=== Full file A: ${group.left.filePath} ===`,
      "```" + lang,
      fileAContent,
      "```",
      "",
      `=== Full file B: ${group.right.filePath} ===`,
      "```" + lang,
      fileBContent,
      "```",
      "",
      "Question: Are Snippet A and Snippet B duplicated code under the definition above?",
      "Answer:",
    ];

    return lines.join("\n");
  }
}
