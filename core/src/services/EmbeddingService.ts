import debug from "debug";
import { OllamaEmbeddings } from "@langchain/ollama";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { IndexUnit } from "../types";
import { configStore } from "../config/configStore";

const log = debug("DryScan:EmbeddingService");

// Model names for each provider
const OLLAMA_MODEL = "embeddinggemma";
const HUGGINGFACE_MODEL = "google/embeddinggemma-300m";

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
            });
        }

        // Ollama (local or remote URL)
        if (/^https?:\/\//i.test(source)) {
            log("Using Ollama at %s with model: %s", source, OLLAMA_MODEL);
            return new OllamaEmbeddings({
                model: OLLAMA_MODEL,
                baseUrl: source,
            });
        }

        const message = `Unsupported embedding source: ${source || "(empty)"}. Use "huggingface" or an Ollama URL.`;
        log(message);
        throw new Error(message);
    }
}