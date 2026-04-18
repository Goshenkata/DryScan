import { exec } from "child_process";
import { promisify } from "util";
import debug from "debug";
import { OllamaEmbeddings } from "@langchain/ollama";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { IndexUnit } from "../types";
import { configStore } from "../config/configStore";

const execAsync = promisify(exec);

const log = debug("DryScan:ModelConnector");

/** Ollama embedding model — override with DRYSCAN_EMBED_MODEL env var. */
const OLLAMA_EMBEDDING_MODEL = process.env.DRYSCAN_EMBED_MODEL ?? "qwen3-embedding:4b";

/** HuggingFace embedding model — override with DRYSCAN_HF_EMBED_MODEL env var. */
const HUGGINGFACE_EMBEDDING_MODEL = process.env.DRYSCAN_HF_EMBED_MODEL ?? "Qwen/Qwen3-Embedding-0.6B";


/**
 * Single entry-point for all model I/O: embedding generation and LLM chat completions.
 * Reads `embeddingSource` from dryconfig.json to locate the Ollama instance (or HuggingFace).
 */
export class ModelConnector {
  constructor(private readonly repoPath: string) {}

  // ── Embeddings ─────────────────────────────────────────────────────────────

  /**
   * Generates a vector embedding for a code unit.
   * Returns the unit unchanged (with `embedding: null`) if code exceeds `contextLength`.
   */
  async embed(unit: IndexUnit): Promise<IndexUnit> {
    const config = await configStore.get(this.repoPath);
    const maxContext = config?.contextLength ?? 2048;

    if (unit.code.length > maxContext) {
      log("Skipping embedding for %s (code %d > context %d)", unit.id, unit.code.length, maxContext);
      return { ...unit, embedding: null };
    }

    const source = config.embeddingSource;
    if (!source) {
      throw new Error(`Embedding source is not configured for repository at ${this.repoPath}`);
    }

    const provider = this.buildEmbeddingProvider(source);
    const embedding = await provider.embedQuery(unit.code);
    return { ...unit, embedding };
  }

  // ── Chat completions ───────────────────────────────────────────────────────

  /**
   * Sends a prompt to the fine-tuned duplication classifier (qwen-duplication-2b)
   * and returns the raw response text (expected: "yes" or "no").
   *
   * Throws on non-OK HTTP status so callers can decide on fallback behaviour.
   */
  async chat(prompt: string): Promise<string> {
    const config = await configStore.get(this.repoPath);
    const baseUrl = this.resolveOllamaChatBaseUrl(config.llmSource, config.embeddingSource);
    const model = config.llmModel;

    log("Sending chat request to %s using model %s", baseUrl, model);

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        think: false,
        options: { temperature: 0, num_predict: 4096 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama chat request failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { message?: { content?: string } };
    const raw = data.message?.content?.trim() ?? "";
    const afterThink = raw.includes("</think>") ? raw.split("</think>").pop()!.trim() : raw;
    return afterThink;
  }

  // ── Ollama chat classify ──────────────────────────────────────────────────

  /**
   * Classifies a (snippetA, snippetB) pair for code duplication using the configured
   * Ollama chat model (config.llmModel).
   *
   * Returns "yes" (duplicate) or "no" (false positive).
   * Defaults to "yes" on error to preserve recall.
   */
  async chatClassify(snippetA: string, snippetB: string): Promise<"yes" | "no"> {
    log("Classifying pair via Ollama chat model");
    const raw = await this.chat(this.buildClassifyPrompt(snippetA, snippetB));
    const verdict: "yes" | "no" = raw.toLowerCase().startsWith("yes") ? "yes" : "no";
    log("Chat classify verdict: %s (raw: %s)", verdict, raw);
    return verdict;
  }

  // ── GitHub Copilot / GPT-4.1 ─────────────────────────────────────────────

  /**
   * Classifies a code pair using GPT-4.1 via the `copilot` CLI.
   * Returns "yes" (duplicate) or "no" (false positive).
   * Defaults to "yes" on error to preserve recall.
   */
  async classifyWithCopilot(snippetA: string, snippetB: string): Promise<"yes" | "no"> {
    const prompt = this.buildClassifyPrompt(snippetA, snippetB);

    // Escape single quotes in prompt for shell safety
    const escaped = prompt.replace(/'/g, `'\\''`);
    const cmd = `copilot --model gpt-4.1 --allow-all-tools --output-format json -p '${escaped}'`;

    log("Classifying pair with GPT-4.1 via copilot CLI");
    const { stdout } = await execAsync(cmd, { timeout: 60_000 });

    // Parse JSONL: find assistant.message event and extract content
    const lines = stdout.split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as { type?: string; data?: { content?: string } };
        if (obj.type === "assistant.message" && obj.data?.content) {
          const content = obj.data.content.trim().toLowerCase();
          const verdict: "yes" | "no" = content.startsWith("yes") ? "yes" : "no";
          log("GPT-4.1 verdict: %s (raw: %s)", verdict, content);
          return verdict;
        }
      } catch {
        // skip non-JSON lines
      }
    }
    throw new Error("No assistant.message found in copilot output");
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildClassifyPrompt(snippetA: string, snippetB: string): string {
    return [
      'Output ONLY the word "yes" or "no" — no punctuation, no explanation.',
      "",
      "Are these two code snippets duplicates of each other — i.e. would a developer want to extract them into a shared method or abstraction?",
      "",
      "Answer YES if:",
      "- They have the same or nearly identical code structure (same body pattern, even if variable/field/type names differ)",
      "- One is a copy of the other with minor modifications (different constant, different DTO type, inverse operation)",
      "- They implement the same logic using different APIs",
      "",
      "Answer NO if:",
      "- One snippet directly calls or delegates to the other (caller-callee relationship)",
      "- They share only incidental framework boilerplate but have entirely different logic and purpose",
      "- They use the same structural container (e.g. if-else, try-catch) but perform fundamentally different operations",
      "",
      "Snippet A:",
      snippetA,
      "",
      "Snippet B:",
      snippetB,
      "",
      "Answer (yes/no):",
    ].join("\n");
  }

  private buildEmbeddingProvider(source: string) {
    if (source.toLowerCase() === "huggingface") {
      // Support both HUGGINGFACEHUB_API_TOKEN and HUGGINGFACEHUB_API_KEY
      const apiKey = process.env.HUGGINGFACEHUB_API_TOKEN ?? process.env.HUGGINGFACEHUB_API_KEY;
      log("Using HuggingFace Inference with model: %s", HUGGINGFACE_EMBEDDING_MODEL);
      return new HuggingFaceInferenceEmbeddings({
        model: HUGGINGFACE_EMBEDDING_MODEL,
        provider: "hf-inference",
        ...(apiKey && { apiKey }),
      });
    }

    const ollamaBaseUrl = this.resolveOllamaEmbeddingBaseUrl(source);
    if (ollamaBaseUrl !== null) {
      log("Using Ollama%s with model: %s", ollamaBaseUrl ? ` at ${ollamaBaseUrl}` : "", OLLAMA_EMBEDDING_MODEL);
      return new OllamaEmbeddings({
        model: OLLAMA_EMBEDDING_MODEL,
        ...(ollamaBaseUrl && { baseUrl: ollamaBaseUrl }),
      });
    }

    throw new Error(
      `Unsupported embedding source: ${source || "(empty)"}. Use "huggingface" or an Ollama URL.`
    );
  }

  /**
   * For embedding providers: returns the URL string, undefined (use Ollama default), or null (not Ollama).
   */
  private resolveOllamaEmbeddingBaseUrl(source: string): string | undefined | null {
    if (/^https?:\/\//i.test(source)) return source;
    if (source.toLowerCase() === "ollama") return undefined;
    return null;
  }

  /**
   * For chat completions: resolves base URL from llmSource (preferred) or falls back to
   * extracting the host from embeddingSource. Defaults to localhost:11434.
   */
  private resolveOllamaChatBaseUrl(llmSource: string, embeddingSource: string): string {
    const src = /^https?:\/\//i.test(llmSource) ? llmSource : embeddingSource;
    if (/^https?:\/\//i.test(src)) {
      const url = new URL(src);
      return `${url.protocol}//${url.host}`;
    }
    return "http://localhost:11434";
  }
}
