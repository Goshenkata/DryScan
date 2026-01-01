import { DuplicateGroup } from "../types";

/**
 * In-memory cache for duplicate comparison scores.
 * Stores a global map of comparison keys and a per-file index for fast invalidation.
 */
export class DuplicationCache {
  private static instance: DuplicationCache | null = null;

  private readonly comparisons = new Map<string, number>();
  private readonly fileIndex = new Map<string, Set<string>>();
  private initialized = false;

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
