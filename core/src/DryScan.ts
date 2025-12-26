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
  

  /**
   * Finds duplicate code blocks using cosine similarity on embeddings.
   * Compares all function pairs and returns groups with similarity above threshold.
   * 
   * @param threshold - Minimum similarity score (0-1) to consider functions as duplicates. Default: 0.85
   * @returns Array of duplicate groups with similarity scores
   */
  async findDuplicates(threshold: number = 0.85): Promise<DuplicateGroup[]> {
    log("Finding duplicates with threshold", threshold);
    
    // Initialize database if needed
    if (!this.db.isInitialized()) {
      const dbPath = upath.join(this.repoPath, DRYSCAN_DIR, INDEX_DB);
      await this.db.init(dbPath);
    }
    
    const allFunctions = await this.db.getAllFunctions();
    const functionsWithEmbeddings = allFunctions.filter(fn => fn.embedding && fn.embedding.length > 0);
    
    log(`Comparing ${functionsWithEmbeddings.length} functions with embeddings`);
    
    if (functionsWithEmbeddings.length < 2) {
      log("Not enough functions with embeddings to compare");
      return [];
    }
    
    const duplicates = this.computeDuplicates(functionsWithEmbeddings, threshold);
    log(`Found ${duplicates.length} duplicate groups`);
    
    return duplicates;
  }

  /**
   * Computes duplicate groups by comparing all function pairs using cosine similarity.
   * Only compares each pair once (i < j) to avoid redundant comparisons.
   * 
   * @param functions - Functions with embeddings to compare
   * @param threshold - Minimum similarity score to consider as duplicate
   * @returns Sorted array of duplicate groups (highest similarity first)
   */
  private computeDuplicates(functions: FunctionInfo[], threshold: number): DuplicateGroup[] {
    const duplicates: DuplicateGroup[] = [];
    
    // Compare each pair of functions
    for (let i = 0; i < functions.length; i++) {
      for (let j = i + 1; j < functions.length; j++) {
        const fn1 = functions[i];
        const fn2 = functions[j];
        
        // Skip if either function lacks embedding
        if (!fn1.embedding || !fn2.embedding) continue;
        
        // Compute cosine similarity between embeddings
        const similarity = cosineSimilarity([fn1.embedding], [fn2.embedding])[0][0];
        
        // Add to duplicates if similarity exceeds threshold
        if (similarity >= threshold) {
          duplicates.push({
            id: `${fn1.id}::${fn2.id}`,
            similarity,
            left: {
              filePath: fn1.filePath,
              startLine: fn1.startLine,
              endLine: fn1.endLine,
              code: fn1.code
            },
            right: {
              filePath: fn2.filePath,
              startLine: fn2.startLine,
              endLine: fn2.endLine,
              code: fn2.code
            }
          });
        }
      }
    }
    
    // Sort by similarity (highest first)
    return duplicates.sort((a, b) => b.similarity - a.similarity);
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
