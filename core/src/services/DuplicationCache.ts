import debug from "debug";
import { DuplicateGroup, IndexUnit, IndexUnitType } from "../types";
import { similarityApi } from "./ParallelSimilarity";

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

  /**
   * Per-run embedding similarity matrices.
   * Stored as flat row-major Float32Array buffers to avoid V8 heap blowups.
   */
  private embSimByType = new Map<IndexUnitType, {
    size: number;
    index: Map<string, number>;
    matrix: Float32Array;
  }>();
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
    this.embSimByType.clear();
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
    // Build per unit type so we avoid a single gigantic n×n matrix for all units.
    // This also matches comparison behavior (we only compare within the same unitType).
    await this.buildEmbSimCacheForType(units, IndexUnitType.CLASS, dirtyPaths);
    await this.buildEmbSimCacheForType(units, IndexUnitType.FUNCTION, dirtyPaths);
    await this.buildEmbSimCacheForType(units, IndexUnitType.BLOCK, dirtyPaths);
  }

  private async buildEmbSimCacheForType(units: IndexUnit[], unitType: IndexUnitType, dirtyPaths?: string[]): Promise<void> {
    const embedded = units.filter(
      (u) => u.unitType === unitType && Array.isArray(u.embedding) && u.embedding.length > 0
    );

    if (embedded.length < 2) {
      // Keep cache entry absent for this type.
      this.embSimByType.delete(unitType);
      return;
    }

    const embeddings = embedded.map((u) => u.embedding as number[]);
    const newIndex = new Map(embedded.map((u, i) => [u.id, i] as [string, number]));
    const dirtySet = dirtyPaths ? new Set(dirtyPaths) : null;
    const prior = this.embSimByType.get(unitType);
    const hasPrior = Boolean(prior);
    const n = embedded.length;

    const canIncremental = Boolean(dirtySet && hasPrior && prior!.size === n);
    if (!canIncremental) {
      const { data } = await similarityApi.parallelCosineSimilarityFlat(embeddings, embeddings, "float32");
      this.embSimByType.set(unitType, { size: n, index: newIndex, matrix: data as Float32Array });
      log("Built embedding similarity matrix for %s: %d units", unitType, embedded.length);
      return;
    }

    // Ensure indices are stable; otherwise, do a full rebuild.
    // (We require the same unit-id -> row mapping between runs.)
    const priorIndex = prior!.index;
    let indicesStable = true;
    for (const [id, idx] of newIndex.entries()) {
      if (priorIndex.get(id) !== idx) {
        indicesStable = false;
        break;
      }
    }

    if (!indicesStable) {
      const { data } = await similarityApi.parallelCosineSimilarityFlat(embeddings, embeddings, "float32");
      this.embSimByType.set(unitType, { size: n, index: newIndex, matrix: data as Float32Array });
      log("Rebuilt embedding similarity matrix for %s (index changed): %d units", unitType, embedded.length);
      return;
    }

    const dirtyIds = new Set(embedded.filter((u) => dirtySet!.has(u.filePath)).map((u) => u.id));
    if (dirtyIds.size === 0) {
      log("Matrix reused for %s: no dirty units detected", unitType);
      return;
    }

    const dirtyIndices = embedded.reduce<number[]>((acc, u, i) => (dirtyIds.has(u.id) ? [...acc, i] : acc), []);
    const dirtyEmbeddings = dirtyIndices.map((i) => embeddings[i]);
    const { data: dirtyRows } = await similarityApi.parallelCosineSimilarityFlat(dirtyEmbeddings, embeddings, "float32");

    const matrix = prior!.matrix;
    dirtyIndices.forEach((rowIdx, di) => {
      const dirtyRowBase = di * n;
      const fullRowBase = rowIdx * n;
      for (let j = 0; j < n; j++) {
        const v = (dirtyRows as Float32Array)[dirtyRowBase + j] ?? 0;
        matrix[fullRowBase + j] = v;
        matrix[j * n + rowIdx] = v;
      }
    });

    // Keep the same backing matrix; update index mapping.
    this.embSimByType.set(unitType, { size: n, index: newIndex, matrix });
    log("Incremental matrix update for %s: %d dirty unit(s) out of %d total", unitType, dirtyIds.size, n);
  }

  /** Returns the pre-computed cosine similarity for a pair of unit IDs, if available. */
  getEmbSim(id1: string, id2: string): number | undefined {
    for (const { size, index, matrix } of this.embSimByType.values()) {
      const i = index.get(id1);
      const j = index.get(id2);
      if (i === undefined || j === undefined) continue;
      return matrix[i * size + j];
    }
    return undefined;
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
