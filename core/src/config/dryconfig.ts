import fs from "fs/promises";
import upath from "upath";
import { Validator, Schema } from "jsonschema";
import { DryConfig } from "../types";

// Baseline config used when no file is present; exported so tests and constructors can seed defaults.
export const DEFAULT_CONFIG: DryConfig = {
  excludedPaths: [
    "**/test/**",
  ],
  excludedPairs: [],
  minLines: 3,
  minBlockLines: 5,
  threshold: 0.88,
  embeddingSource: "http://localhost:11434",
  contextLength: 2048,
};

const validator = new Validator();

const partialConfigSchema: Schema = {
  type: "object",
  properties: {
    excludedPaths: { type: "array", items: { type: "string" } },
    excludedPairs: { type: "array", items: { type: "string" } },
    minLines: { type: "number" },
    minBlockLines: { type: "number" },
    threshold: { type: "number" },
    embeddingSource: { type: "string" },
    contextLength: { type: "number" },
  },
};

const fullConfigSchema: Schema = {
  ...partialConfigSchema,
  required: [
    "excludedPaths",
    "excludedPairs",
    "minLines",
    "minBlockLines",
    "threshold",
    "embeddingSource",
    "contextLength",
  ],
};

function validateConfig(raw: unknown, schema: Schema, source: string): any {
  const result = validator.validate(raw, schema);
  if (!result.valid) {
    const details = result.errors.map((e) => e.stack).join("; ");
    throw new Error(`${source} config is invalid: ${details}`);
  }
  return raw;
}

async function readConfigFile(repoPath: string): Promise<Partial<DryConfig>> {
  const configPath = upath.join(repoPath, "dryconfig.json");
  try {
    const content = await fs.readFile(configPath, "utf8");
    let parsed: Partial<DryConfig> = {};
    try {
      parsed = JSON.parse(content) as Partial<DryConfig>;
    } catch (parseErr) {
      throw new Error(`Invalid JSON in ${configPath}: ${(parseErr as Error).message}`);
    }
    return parsed;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

/**
 * Resolves the effective config for a repo using defaults merged with any file config.
 */
export async function resolveDryConfig(repoPath: string): Promise<DryConfig> {
  const fileConfigRaw = await readConfigFile(repoPath);
  validateConfig(fileConfigRaw, partialConfigSchema, "Config file");

  const merged = { ...DEFAULT_CONFIG, ...fileConfigRaw };
  validateConfig(merged, fullConfigSchema, "Merged");
  return merged as DryConfig;
}

// Backwards-compatible helper used by existing callers (file + defaults).
export async function loadDryConfig(repoPath: string): Promise<DryConfig> {
  return resolveDryConfig(repoPath);
}

export async function saveDryConfig(repoPath: string, config: DryConfig): Promise<void> {
  const configPath = upath.join(repoPath, "dryconfig.json");
  validateConfig(config, fullConfigSchema, "Config to save");
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

export async function ensureDefaultConfig(repoPath: string): Promise<void> {
  const configPath = upath.join(repoPath, "dryconfig.json");
  const repoExists = await fs.stat(repoPath).then((s) => s.isDirectory()).catch((err: any) => {
    if (err?.code === "ENOENT") return false;
    throw err;
  });

  if (!repoExists) return;

  const exists = await fs.stat(configPath).then(() => true).catch((err: any) => {
    if (err?.code === "ENOENT") return false;
    throw err;
  });

  if (!exists) {
    await saveDryConfig(repoPath, DEFAULT_CONFIG);
  }
}
