import debug from "debug";
import { cosineSimilarity } from "@langchain/core/utils/math";
import { DuplicateGroup, IndexUnit } from "../types";

const log = debug("DryScan:DuplicationCache");

/**
 * In-memory cache for duplicate comparison scores.
 * Stores a global map of comparison keys and a per-file index for fast invalidation.
 */
export class DuplicationCache {
  private static instance: DuplicationCache | null = null;

  private readonly comparisons = new Map<string, number>();
  private readonly fileIndex = new Map<string, Set<string>>();
  private initialized = false;

  /** Per-run similarity matrix from a single batched library call (reset each run). */
  private embSimMatrix: number[][] = [];
  /** Maps unit ID to its row/column index in embSimMatrix. */
  private embSimIndex = new Map<string, number>();
  /** Per-run memoization of parent unit similarity scores (reset each run). */
  private parentSimCache = new Map<string, number>();

  static getInstance(): DuplicationCache {
    if (!DuplicationCache.instance) {
      DuplicationCache.instance = new DuplicationCache();
    }
    return DuplicationCache.instance;
  }

  /**
   * Updates the cache with fresh duplicate groups. Not awaited by callers to avoid blocking.
   */
  async update(groups: DuplicateGroup[]): Promise<void> {
    if (!groups) return;

    for (const group of groups) {
      const key = this.makeKey(group.left.id, group.right.id);
      this.comparisons.set(key, group.similarity);
      this.addKeyForFile(group.left.filePath, key);
      this.addKeyForFile(group.right.filePath, key);
    }

    this.initialized = this.initialized || groups.length > 0;
  }

  /**
   * Retrieves a cached similarity if present and valid for both file paths.
   * Returns null when the cache has not been initialized or when the pair is missing.
   */
  get(leftId: string, rightId: string, leftFilePath: string, rightFilePath: string): number | null {
    if (!this.initialized) return null;

    const key = this.makeKey(leftId, rightId);
    if (!this.fileHasKey(leftFilePath, key) || !this.fileHasKey(rightFilePath, key)) {
      return null;
    }

    const value = this.comparisons.get(key);
    return typeof value === "number" ? value : null;
  }

  /**
   * Invalidates all cached comparisons involving the provided file paths.
   */
  async invalidate(paths: string[]): Promise<void> {
    if (!this.initialized || !paths || paths.length === 0) return;

    const unique = new Set(paths);
    for (const filePath of unique) {
      const keys = this.fileIndex.get(filePath);
      if (!keys) continue;

      for (const key of keys) {
        this.comparisons.delete(key);
        for (const [otherPath, otherKeys] of this.fileIndex.entries()) {
          if (otherKeys.delete(key) && otherKeys.size === 0) {
            this.fileIndex.delete(otherPath);
          }
        }
      }

      this.fileIndex.delete(filePath);
    }

    if (this.comparisons.size === 0) {
      this.initialized = false;
    }
  }

  /**
   * Clears all cached data. Intended for test setup.
   */
  clear(): void {
    this.comparisons.clear();
    this.fileIndex.clear();
    this.initialized = false;
    this.clearRunCaches();
  }

  /**
   * Resets the per-run embedding and parent similarity caches.
   * Should be called at the start of each findDuplicates run.
   */
  clearRunCaches(): void {
    this.embSimMatrix = [];
    this.embSimIndex.clear();
    this.parentSimCache.clear();
  }

  /**
   * Runs a single batched cosineSimilarity call and retains the raw matrix.
   * Lookups are O(1) via an id-to-index map — no per-pair map writes.
   */
  buildEmbSimCache(units: IndexUnit[]): void {
    this.embSimMatrix = [];
    this.embSimIndex.clear();
    const embedded = units.filter(u => Array.isArray(u.embedding) && u.embedding.length > 0);
    if (embedded.length < 2) return;

    const embeddings = embedded.map(u => u.embedding as number[]);
    embedded.forEach((u, i) => this.embSimIndex.set(u.id, i));
    this.embSimMatrix = cosineSimilarity(embeddings, embeddings);
    log("Built embedding similarity matrix: %d units", embedded.length);
  }

  /** Returns the pre-computed cosine similarity for a pair of unit IDs, if available. */
  getEmbSim(id1: string, id2: string): number | undefined {
    const i = this.embSimIndex.get(id1);
    const j = this.embSimIndex.get(id2);
    if (i === undefined || j === undefined) return undefined;
    return this.embSimMatrix[i][j];
  }

  /** Returns the memoized parent similarity for the given stable key, if available. */
  getParentSim(key: string): number | undefined {
    return this.parentSimCache.get(key);
  }

  /** Stores a memoized parent similarity for the given stable key. */
  setParentSim(key: string, sim: number): void {
    this.parentSimCache.set(key, sim);
  }

  private addKeyForFile(filePath: string, key: string): void {
    const current = this.fileIndex.get(filePath) ?? new Set<string>();
    current.add(key);
    this.fileIndex.set(filePath, current);
  }

  private fileHasKey(filePath: string, key: string): boolean {
    const keys = this.fileIndex.get(filePath);
    return keys ? keys.has(key) : false;
  }

  private makeKey(leftId: string, rightId: string): string {
    return [leftId, rightId].sort().join("::");
  }
}
