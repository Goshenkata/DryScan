import "reflect-metadata";
import fs from "fs/promises";
import upath from "upath";
import { DataSource, Repository, In } from "typeorm";
import { FileEntity } from "./entities/FileEntity";
import { IndexUnit } from "../types";
import { IndexUnitEntity } from "./entities/IndexUnitEntity";

export class DryScanDatabase {
  private dataSource?: DataSource;
  private unitRepository?: Repository<IndexUnitEntity>;
  private fileRepository?: Repository<FileEntity>;

  isInitialized(): boolean {
    return !!this.dataSource?.isInitialized;
  }

  async init(dbPath: string): Promise<void> {
    await fs.mkdir(upath.dirname(dbPath), { recursive: true });

    this.dataSource = new DataSource({
      type: "sqlite",
      database: dbPath,
      entities: [IndexUnitEntity, FileEntity],
      synchronize: true,
      logging: false,
    });

    await this.dataSource.initialize();
    this.unitRepository = this.dataSource.getRepository(IndexUnitEntity);
    this.fileRepository = this.dataSource.getRepository(FileEntity);
  }

  async saveUnit(unit: IndexUnit): Promise<void> {
    await this.saveUnits(unit);
  }

  async saveUnits(units: IndexUnit | IndexUnit[]): Promise<void> {
    if (!this.unitRepository) throw new Error("Database not initialized");
    const payload = Array.isArray(units) ? units : [units];
    await this.unitRepository.save(payload);
  }

  async getUnit(id: string): Promise<IndexUnit | null> {
    if (!this.unitRepository) throw new Error("Database not initialized");
    return this.unitRepository.findOne({ 
      where: { id },
      relations: ["children", "parent"]
    });
  }

  async getAllUnits(): Promise<IndexUnit[]> {
    if (!this.unitRepository) throw new Error("Database not initialized");
    return this.unitRepository.find({ relations: ["children", "parent"] });
  }

  async updateUnit(unit: IndexUnit): Promise<void> {
    await this.saveUnits(unit);
  }

  async updateUnits(units: IndexUnit | IndexUnit[]): Promise<void> {
    await this.saveUnits(units);
  }

  /**
   * Returns total count of indexed units.
   */
  async countUnits(): Promise<number> {
    if (!this.unitRepository) throw new Error("Database not initialized");
    return this.unitRepository.count();
  }

  /**
   * Removes index units by their file paths.
   * Used during incremental updates when files change.
   */
  async removeUnitsByFilePaths(filePaths: string[]): Promise<void> {
    if (!this.unitRepository) throw new Error("Database not initialized");
    await this.unitRepository.delete({ filePath: In(filePaths) });
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
