import upath from "upath";
import fs from "fs/promises";
import debug from "debug";
import { DuplicateGroup, EmbeddingResult, FunctionInfo } from "./types";
import { DRYSCAN_DIR, INDEX_DB } from "./const";
import { defaultExtractors, FunctionExtractor } from "./FunctionExtractor";
import { DryScanDatabase } from "./db/DryScanDatabase";
import { OllamaEmbeddings } from "@langchain/ollama";
import { cosineSimilarity } from "@langchain/core/utils/math";

const log = debug("DryScan");

export class DryScan {
  repoPath: string;
  private functionExtractor: FunctionExtractor;
  private db: DryScanDatabase;

  constructor(
    repoPath: string,
    functionExtractor?: FunctionExtractor,
    db?: DryScanDatabase
  ) {
    this.repoPath = repoPath;
    this.functionExtractor = functionExtractor ?? new FunctionExtractor(repoPath, defaultExtractors());
    this.db = db ?? new DryScanDatabase();
  }

  /**
   * Initializes the DryScan repository with a 3-phase analysis:
   * Phase 1: Extract and save all functions
   * Phase 2: Resolve and save internal dependencies
   * Phase 3: Compute and save semantic embeddings
   */
  async init(): Promise<void> {
    log("Initializing DryScan repository at", this.repoPath);
    if (await this.isInitialized()) {
      log("Repository already initialized.");
      return;
    }
    const dbPath = upath.join(this.repoPath, DRYSCAN_DIR, INDEX_DB);
    await fs.mkdir(upath.dirname(dbPath), { recursive: true });
    await this.db.init(dbPath);

    log("Phase 1: Extracting functions...");
    await this.initFunctions();
    log("Phase 2: Resolving internal dependencies...");
    await this.applyDependencies();
    log("Phase 3: Computing embeddings...");
    await this.computeEmbeddings();
    log("DryScan initialization complete.");
  }

  /**
   * Phase 1: Scans repository and extracts all functions.
   * Saves functions to DB with internalFunctions undefined.
   */
  private async initFunctions(): Promise<void> {
    try {
      const functions = await this.functionExtractor.scan(this.repoPath);
      log(`Extracted ${functions.length} functions.`);
      await this.db.saveFunctions(functions);
      log("Functions saved to database.");
    } catch (err) {
      log("Error during function extraction:", err);
      throw err;
    }
  }

  /**
   * Phase 2: Resolves internal dependencies for all functions.
   * Loads all functions, applies dependency resolution, and saves back.
   */
  private async applyDependencies(): Promise<void> {
    try {
      const allFunctions = await this.db.getAllFunctions();
      const updated = await this.functionExtractor.applyInternalDependencies(allFunctions, allFunctions);
      log("Resolved internal dependencies for all functions.");
      await this.db.updateFunctions(updated);
      log("Updated functions with dependencies in database.");
    } catch (err) {
      log("Error during dependency resolution:", err);
      throw err;
    }
  }

  /**
   * Phase 3: Computes semantic embeddings for duplicate detection.
   * 
   * TODO: Implement embedding computation
   */
  private async computeEmbeddings(): Promise<void> {
    try {
      const allFunctions = await this.db.getAllFunctions();
      log(`Computing embeddings for ${allFunctions.length} functions...`);
      const updated: FunctionInfo[] = await Promise.all(allFunctions.map(fn => addEmbedding(fn)));
      await this.db.updateFunctions(updated);
      log("Embeddings computed and saved.");
    } catch (err) {
      log("Error during embedding computation:", err);
      throw err;
    }
  }
  

  async findDuplicates(): Promise<DuplicateGroup[]> {
    log("Finding duplicates...");
    // ...actual logic here
    return [];
  }

  private async isInitialized(): Promise<boolean> {
    const indexPath = upath.join(this.repoPath, DRYSCAN_DIR, INDEX_DB);
    try {
      const stat = await fs.stat(indexPath);
      log("Index file found at", indexPath);
      return stat.isFile();
    } catch (err: any) {
      if (err.code === "ENOENT") {
        log("Index file not found at", indexPath);
        return false;
      }
      log("Error checking initialization:", err);
      throw err;
    }
  }
}

async function addEmbedding(fn: FunctionInfo): Promise<any> {
const embeddings = new OllamaEmbeddings({
  model: "embeddinggemma",
  baseUrl: process.env.OLLAMA_API_URL || "http://localhost:11434",
});
const embedding = await embeddings.embedQuery(fn.code);
fn.embedding = embedding;
return fn;
}
