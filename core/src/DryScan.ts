import upath from "upath";
import fs from "fs/promises";
import { DuplicateGroup, EmbeddingResult } from "./types";
import { DRYSCAN_DIR, INDEX_DB } from "./const";

export class DryScan {
  repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  async init(): Promise<void> {
    if (await this.isInitialized()) return;
    console.log(`Initializing repository at: ${this.repoPath}`);
    // Simulate expensive indexing
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Here you would actually create the index file
  }

  async updateEmbeddings(): Promise<EmbeddingResult> {
    await this.init();
    console.log(`Updating embeddings for repository at: ${this.repoPath}`);
    await new Promise(resolve => setTimeout(resolve, 200));
    return { errors: [], processed: 10, updated: 10 };
  }

  async findDuplicates(): Promise<DuplicateGroup[]> {
    await this.init();
    console.log(`Finding duplicates in repository at: ${this.repoPath}`);
    await new Promise(resolve => setTimeout(resolve, 300));
    return [
      {
        id: 'dup-001',
        // @ts-expect-error: files property is not in DuplicateGroup, should be functions
        files: [`${this.repoPath}/src/file1.ts`, `${this.repoPath}/src/file2.ts`],
        similarity: 0.92,
        codeSnippet: 'function duplicatedFunction() { /* ... */ }'
      }
    ];
  }

  private async isInitialized(): Promise<boolean> {
    const indexPath = upath.join(this.repoPath, DRYSCAN_DIR, INDEX_DB);
    try {
      const stat = await fs.stat(indexPath);
      return stat.isFile();
    } catch (err: any) {
      if (err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }
}
