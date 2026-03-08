import debug from "debug";
import { DuplicateGroup, IndexUnit } from "../types";
import { parallelCosineSimilarity } from "./ParallelSimilarity";

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
    this.embSimMatrix = [];
    this.embSimIndex.clear();
    this.clearRunCaches();
  }

  /**
   * Resets per-run memoization (parent similarities).
   * The embedding matrix is intentionally preserved so incremental runs can
   * reuse clean×clean values across calls.
   */
  clearRunCaches(): void {
    this.parentSimCache.clear();
  }

  /**
   * Builds or incrementally updates the embedding similarity matrix.
   *
   * Full rebuild (default): replaces the entire matrix — O(n²).
   * Incremental (dirtyPaths provided + prior matrix exists): copies clean×clean
   * cells from the old matrix and recomputes only dirty rows via one batched
   * cosineSimilarity call — O(d·n) where d = number of dirty units.
   */
  async buildEmbSimCache(units: IndexUnit[], dirtyPaths?: string[]): Promise<void> {
    const embedded = units.filter(u => Array.isArray(u.embedding) && u.embedding.length > 0);
    if (embedded.length < 2) {
      this.embSimMatrix = [];
      this.embSimIndex.clear();
      return;
    }

    const embeddings = embedded.map(u => u.embedding as number[]);
    const newIndex = new Map(embedded.map((u, i) => [u.id, i] as [string, number]));
    const dirtySet = dirtyPaths ? new Set(dirtyPaths) : null;
    const hasPriorMatrix = this.embSimMatrix.length > 0;

    if (!dirtySet || !hasPriorMatrix) {
      // Full rebuild
      this.embSimIndex = newIndex;
      this.embSimMatrix = await parallelCosineSimilarity(embeddings, embeddings);
      log("Built full embedding similarity matrix: %d units", embedded.length);
      return;
    }

    // Incremental: identify dirty unit IDs
    const dirtyIds = new Set(embedded.filter(u => dirtySet.has(u.filePath)).map(u => u.id));

    if (dirtyIds.size === 0) {
      log("Matrix reused: no dirty units detected");
      return;
    }

    const n = embedded.length;

    // Start with zeroes; copy clean×clean values from prior matrix
    const newMatrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (dirtyIds.has(embedded[i].id) || dirtyIds.has(embedded[j].id)) continue;
        const oi = this.embSimIndex.get(embedded[i].id);
        const oj = this.embSimIndex.get(embedded[j].id);
        if (oi !== undefined && oj !== undefined) newMatrix[i][j] = this.embSimMatrix[oi][oj];
      }
    }

    // Recompute dirty rows in one batched call
    const dirtyIndices = embedded.reduce<number[]>((acc, u, i) => (dirtyIds.has(u.id) ? [...acc, i] : acc), []);
    const dirtyRows = await parallelCosineSimilarity(dirtyIndices.map(i => embeddings[i]), embeddings);
    dirtyIndices.forEach((rowIdx, di) => {
      for (let j = 0; j < n; j++) {
        newMatrix[rowIdx][j] = dirtyRows[di][j];
        newMatrix[j][rowIdx] = dirtyRows[di][j];
      }
    });

    this.embSimIndex = newIndex;
    this.embSimMatrix = newMatrix;
    log("Incremental matrix update: %d dirty unit(s) out of %d total", dirtyIds.size, n);
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
