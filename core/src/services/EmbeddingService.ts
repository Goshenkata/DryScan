import debug from "debug";
import { OllamaEmbeddings } from "@langchain/ollama";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { IndexUnit } from "../types";
import { configStore } from "../config/configStore";

const log = debug("DryScan:EmbeddingService");

// Model names for each provider
const OLLAMA_MODEL = "qwen3-embedding:0.6b";
const HUGGINGFACE_MODEL = "Qwen/Qwen3-Embedding-0.6B";

export class EmbeddingService {
    constructor(private readonly repoPath: string) { }

    /**
     * Generates an embedding for the given index unit using the configured provider.
     * Skips embedding if code exceeds the configured context length.
     */
    async addEmbedding(fn: IndexUnit): Promise<IndexUnit> {
        const config = await configStore.get(this.repoPath);
        const maxContext = config?.contextLength ?? 2048;
        if (fn.code.length > maxContext) {
            log(
                "Skipping embedding for %s (code length %d exceeds context %d)",
                fn.id,
                fn.code.length,
                maxContext
            );
            return { ...fn, embedding: null };
        }

        const source = config.embeddingSource;
        if (!source) {
            const message = `Embedding source is not configured for repository at ${this.repoPath}`;
            log(message);
            throw new Error(message);
        }

        const embeddings = this.buildProvider(source);
        const embedding = await embeddings.embedQuery(fn.code);
        return { ...fn, embedding };
    }

    /**
     * Builds the embedding provider based on the source configuration.
     * - URL (http/https): Uses Ollama with "embeddinggemma" model
     * - "huggingface": Uses HuggingFace Inference API with "embeddinggemma-300m" model
     */
    private buildProvider(source: string) {
        // HuggingFace Inference API
        if (source.toLowerCase() === "huggingface") {
            log("Using HuggingFace Inference with model: %s", HUGGINGFACE_MODEL);
            return new HuggingFaceInferenceEmbeddings({
                model: HUGGINGFACE_MODEL,
                provider: "hf-inference",
            });
        }

        // Ollama keyword or direct URL
        const ollamaBaseUrl = this.resolveOllamaBaseUrl(source);
        if (ollamaBaseUrl !== null) {
            log("Using Ollama%s with model: %s", ollamaBaseUrl ? ` at ${ollamaBaseUrl}` : "", OLLAMA_MODEL);
            return new OllamaEmbeddings({ model: OLLAMA_MODEL, ...(ollamaBaseUrl && { baseUrl: ollamaBaseUrl }) });
        }

        const message = `Unsupported embedding source: ${source || "(empty)"}. Use "huggingface" or an Ollama URL.`;
        log(message);
        throw new Error(message);
    }

    /**
     * Returns the Ollama base URL if source is an HTTP URL, undefined if source is "ollama" (use default),
     * or null if source is not an Ollama provider at all.
     */
    private resolveOllamaBaseUrl(source: string): string | undefined | null {
        if (/^https?:\/\//i.test(source)) return source;
        if (source.toLowerCase() === "ollama") return undefined;
        return null;
    }
}