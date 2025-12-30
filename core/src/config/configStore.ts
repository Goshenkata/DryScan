import upath from "upath";
import { DryConfig, resolveDryConfig, saveDryConfig } from "./dryconfig";

class ConfigStore {
  private readonly cache = new Map<string, DryConfig>();
  private readonly overrides = new Map<string, Partial<DryConfig> | undefined>();
  private readonly loading = new Map<string, Promise<DryConfig>>();

  async init(repoPath: string, overrides?: Partial<DryConfig>): Promise<DryConfig> {
    const key = this.normalize(repoPath);
    if (overrides !== undefined) {
      this.overrides.set(key, overrides);
    }
    return this.load(key, repoPath);
  }

  async get(repoPath: string): Promise<DryConfig> {
    const key = this.normalize(repoPath);
    const cached = this.cache.get(key);
    if (cached) return cached;
    return this.load(key, repoPath);
  }

  async refresh(repoPath: string): Promise<DryConfig> {
    const key = this.normalize(repoPath);
    this.cache.delete(key);
    return this.load(key, repoPath);
  }

  async save(repoPath: string, config: DryConfig): Promise<void> {
    const key = this.normalize(repoPath);
    await saveDryConfig(repoPath, config);
    this.cache.set(key, config);
  }

  private async load(key: string, repoPath: string): Promise<DryConfig> {
    const existing = this.loading.get(key);
    if (existing) return existing;

    const promise = resolveDryConfig(repoPath, this.overrides.get(key)).then((config) => {
      this.cache.set(key, config);
      this.loading.delete(key);
      return config;
    }).catch((err) => {
      this.loading.delete(key);
      throw err;
    });

    this.loading.set(key, promise);
    return promise;
  }

  private normalize(repoPath: string): string {
    return upath.normalizeTrim(upath.resolve(repoPath));
  }
}

export const configStore = new ConfigStore();
