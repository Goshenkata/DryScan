import "reflect-metadata";
import fs from "fs/promises";
import upath from "upath";
import { DataSource, Repository, In } from "typeorm";
import { FunctionEntity } from "./entities/FunctionEntity";
import { FileEntity } from "./entities/FileEntity";
import { FunctionInfo } from "../types";

export class DryScanDatabase {
  private dataSource?: DataSource;
  private functionRepository?: Repository<FunctionEntity>;
  private fileRepository?: Repository<FileEntity>;

  isInitialized(): boolean {
    return !!this.dataSource?.isInitialized;
  }

  async init(dbPath: string): Promise<void> {
    await fs.mkdir(upath.dirname(dbPath), { recursive: true });

    this.dataSource = new DataSource({
      type: "better-sqlite3",
      database: dbPath,
      entities: [FunctionEntity, FileEntity],
      synchronize: true,
      logging: false,
    });

    await this.dataSource.initialize();
    this.functionRepository = this.dataSource.getRepository(FunctionEntity);
    this.fileRepository = this.dataSource.getRepository(FileEntity);
  }

  async saveFunction(fn: FunctionInfo): Promise<void> {
    if (!this.functionRepository) throw new Error("Database not initialized");
    await this.functionRepository.save(fn);
  }

  async saveFunctions(functions: FunctionInfo[]): Promise<void> {
    if (!this.functionRepository) throw new Error("Database not initialized");
    await this.functionRepository.save(functions);
  }

  async getFunction(id: string): Promise<FunctionInfo | null> {
    if (!this.functionRepository) throw new Error("Database not initialized");
    return this.functionRepository.findOne({ 
      where: { id },
      relations: ["internalFunctions"]
    });
  }

  async getAllFunctions(): Promise<FunctionInfo[]> {
    if (!this.functionRepository) throw new Error("Database not initialized");
    return this.functionRepository.find({ relations: ["internalFunctions"] });
  }

  async updateFunction(fn: FunctionInfo): Promise<void> {
    if (!this.functionRepository) throw new Error("Database not initialized");
    await this.functionRepository.save(fn);
  }

  async updateFunctions(functions: FunctionInfo[]): Promise<void> {
    if (!this.functionRepository) throw new Error("Database not initialized");
    await this.functionRepository.save(functions);
  }

  /**
   * Removes functions by their file paths.
   * Used during incremental updates when files change.
   */
  async removeFunctionsByFilePaths(filePaths: string[]): Promise<void> {
    if (!this.functionRepository) throw new Error("Database not initialized");
    await this.functionRepository.delete({ filePath: In(filePaths) });
  }

  /**
   * Saves file metadata (path, checksum, mtime) to track changes.
   */
  async saveFile(file: FileEntity): Promise<void> {
    if (!this.fileRepository) throw new Error("Database not initialized");
    await this.fileRepository.save(file);
  }

  /**
   * Saves multiple file metadata entries.
   */
  async saveFiles(files: FileEntity[]): Promise<void> {
    if (!this.fileRepository) throw new Error("Database not initialized");
    await this.fileRepository.save(files);
  }

  /**
   * Gets file metadata by file path.
   */
  async getFile(filePath: string): Promise<FileEntity | null> {
    if (!this.fileRepository) throw new Error("Database not initialized");
    return this.fileRepository.findOne({ where: { filePath } });
  }

  /**
   * Gets all tracked files.
   */
  async getAllFiles(): Promise<FileEntity[]> {
    if (!this.fileRepository) throw new Error("Database not initialized");
    return this.fileRepository.find();
  }

  /**
   * Removes file metadata entries by file paths.
   * Used when files are deleted from repository.
   */
  async removeFilesByFilePaths(filePaths: string[]): Promise<void> {
    if (!this.fileRepository) throw new Error("Database not initialized");
    await this.fileRepository.delete({ filePath: In(filePaths) });
  }

  async close(): Promise<void> {
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
    }
  }
}
