import debug from "debug";
import { OllamaEmbeddings } from "@langchain/ollama";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { TaskType } from "@google/generative-ai";
import { IndexUnit } from "../types";
import { configStore } from "../config/configStore";

const log = debug("DryScan:EmbeddingService");

export class EmbeddingService {
    constructor(private readonly repoPath: string) { }

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

        const model = config.embeddingModel ?? undefined
        const source = config.embeddingSource
        if (!source) {
            const message = `Embedding source is not configured for repository at ${this.repoPath}`;
            log(message);
            throw new Error(message);
        }

        const embeddings = this.buildProvider(source, model);
        const embedding = await embeddings.embedQuery(fn.code);
        return { ...fn, embedding };
    }

    private buildProvider(source: string, model: string) {
        if (source === "google") {
            return new GoogleGenerativeAIEmbeddings({
                model: model ?? "gemini-embedding-001",
                taskType: TaskType.SEMANTIC_SIMILARITY,
            });
        }

        if (/^https?:\/\//i.test(source)) {
            return new OllamaEmbeddings({
                model: model ?? "embeddinggemma",
                baseUrl: source,
            });
        }

        const message = `Unsupported embedding source: ${source || "(empty)"}`;
        log(message);
        throw new Error(message);
    }
}