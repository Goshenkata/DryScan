import debug from "debug";
import { OllamaEmbeddings } from "@langchain/ollama";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { IndexUnit } from "../types";
import { configStore } from "../config/configStore";

const log = debug("DryScan:ModelConnector");

/** Ollama embedding model (vector search). */
const OLLAMA_EMBEDDING_MODEL = "qwen3-embedding:4b";

/** HuggingFace mirror of the same embedding model. */
const HUGGINGFACE_EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-0.6B";

/**
 * Fine-tuned duplication classifier served via Ollama.
 * Loaded from qwen-duplication-2b:latest — see ../../../DryScanDiplomna/finetune/TRAINING_FORMAT.md.
 */
const OLLAMA_CHAT_MODEL = process.env.DRYSCAN_CHAT_MODEL ?? "gemma4:e4b";

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
    const baseUrl = this.resolveOllamaChatBaseUrl(config.embeddingSource);

    log("Sending chat request to %s using model %s", baseUrl, OLLAMA_CHAT_MODEL);

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_CHAT_MODEL,
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

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildEmbeddingProvider(source: string) {
    if (source.toLowerCase() === "huggingface") {
      log("Using HuggingFace Inference with model: %s", HUGGINGFACE_EMBEDDING_MODEL);
      return new HuggingFaceInferenceEmbeddings({
        model: HUGGINGFACE_EMBEDDING_MODEL,
        provider: "hf-inference",
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
   * For chat completions: extracts host from an HTTP URL, or falls back to localhost.
   */
  private resolveOllamaChatBaseUrl(source: string): string {
    if (/^https?:\/\//i.test(source)) {
      const url = new URL(source);
      return `${url.protocol}//${url.host}`;
    }
    return "http://localhost:11434";
  }
}
