import fs from "fs/promises";
import upath from "upath";

export interface DryConfig {
  excludedPaths: string[];
  excludedPairs: string[];
  maxLines: number;
  maxBlockLines: number;
  threshold: number;
  embeddingModel: string;
  embeddingBaseUrl?: string;
}

// Baseline config used when no file is present; exported so tests and constructors can seed defaults.
export const DEFAULT_CONFIG: DryConfig = {
  excludedPaths: [],
  excludedPairs: [],
  maxLines: 500,
  maxBlockLines: 200,
  threshold: 0.85,
  embeddingModel: "embeddinggemma",
  embeddingBaseUrl: process.env.OLLAMA_API_URL || "http://localhost:11434",
};

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

// Normalize user-provided config to keep runtime assumptions simple and typed (arrays, numbers only).
function normalizeConfig(raw: Partial<DryConfig>): DryConfig {
  const maxLines = normalizeNumber(raw.maxLines);
  const maxBlockLines = normalizeNumber(raw.maxBlockLines);
  const threshold = normalizeNumber(raw.threshold);
  const embeddingModel = typeof raw.embeddingModel === "string" && raw.embeddingModel.trim()
    ? raw.embeddingModel.trim()
    : undefined;
  const embeddingBaseUrl = typeof raw.embeddingBaseUrl === "string" && raw.embeddingBaseUrl.trim()
    ? raw.embeddingBaseUrl.trim()
    : undefined;

  return {
    excludedPaths: normalizeStringArray(raw.excludedPaths),
    excludedPairs: normalizeStringArray(raw.excludedPairs),
    maxLines: maxLines ?? DEFAULT_CONFIG.maxLines,
    maxBlockLines: maxBlockLines ?? DEFAULT_CONFIG.maxBlockLines,
    threshold: threshold ?? DEFAULT_CONFIG.threshold,
    embeddingModel: embeddingModel ?? DEFAULT_CONFIG.embeddingModel,
    embeddingBaseUrl: embeddingBaseUrl ?? DEFAULT_CONFIG.embeddingBaseUrl,
  };
}

export async function loadDryConfig(repoPath: string): Promise<DryConfig> {
  const configPath = upath.join(repoPath, ".dryconfig.json");
  try {
    const content = await fs.readFile(configPath, "utf8");
    let parsed: Partial<DryConfig> = {};
    try {
      parsed = JSON.parse(content) as Partial<DryConfig>;
    } catch (parseErr) {
      throw new Error(`Invalid JSON in ${configPath}: ${(parseErr as Error).message}`);
    }
    return { ...DEFAULT_CONFIG, ...normalizeConfig(parsed) };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { ...DEFAULT_CONFIG };
    }
    throw err;
  }
}

export async function saveDryConfig(repoPath: string, config: DryConfig): Promise<void> {
  const configPath = upath.join(repoPath, ".dryconfig.json");
  const normalized = { ...DEFAULT_CONFIG, ...normalizeConfig(config) };
  await fs.writeFile(configPath, JSON.stringify(normalized, null, 2), "utf8");
}
