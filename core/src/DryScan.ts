import upath from "upath";
import fs from "fs/promises";
import { DuplicateGroup, EmbeddingResult, FunctionInfo, IndexUnit } from "./types";
import { DRYSCAN_DIR, INDEX_DB } from "./const";
import { defaultExtractors, FunctionExtractor } from "./FunctionExtractor";
import { DryScanDatabase } from "./db/DryScanDatabase";
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

  async init(): Promise<void> {
    if (await this.isInitialized()) return;
    const dbPath = upath.join(this.repoPath, DRYSCAN_DIR, INDEX_DB);
    await fs.mkdir(upath.dirname(dbPath), { recursive: true });
    await this.db.init(dbPath);
  }
  

  async updateEmbeddings(): Promise<EmbeddingResult> {
    await this.init();
    console.log(`Updating embeddings for repository at: ${this.repoPath}`);
    await new Promise(resolve => setTimeout(resolve, 200));

    const functions: IndexUnit[] = await this.functionExtractor.scan(this.repoPath);
    await this.db.updateIndexUnit(functions);

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