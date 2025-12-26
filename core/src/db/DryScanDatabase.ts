import "reflect-metadata";
import fs from "fs/promises";
import upath from "upath";
import { DataSource, Repository } from "typeorm";
import { FunctionEntity } from "./entities/FunctionEntity";
import { FunctionInfo } from "../types";

export class DryScanDatabase {
  private dataSource?: DataSource;
  private functionRepository?: Repository<FunctionEntity>;

  isInitialized(): boolean {
    return !!this.dataSource?.isInitialized;
  }

  async init(dbPath: string): Promise<void> {
    await fs.mkdir(upath.dirname(dbPath), { recursive: true });

    this.dataSource = new DataSource({
      type: "better-sqlite3",
      database: dbPath,
      entities: [FunctionEntity],
      synchronize: true,
      logging: false,
    });

    await this.dataSource.initialize();
    this.functionRepository = this.dataSource.getRepository(FunctionEntity);
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

  async close(): Promise<void> {
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
    }
  }
}
