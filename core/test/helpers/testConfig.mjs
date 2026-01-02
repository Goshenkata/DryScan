import fs from "fs/promises";
import path from "path";
import { DEFAULT_CONFIG } from "../../src/config/dryconfig.ts";

function baseEmbeddingConfig() {
  if (process.env.GOOGLE_API_KEY) {
    return {
      embeddingSource: "google",
      embeddingModel: "gemini-embedding-001",
    };
  }
  return {
    embeddingSource: DEFAULT_CONFIG.embeddingSource,
    embeddingModel: DEFAULT_CONFIG.embeddingModel,
  };
}

export function buildTestConfig(overrides = {}) {
  const embeddingDefaults = baseEmbeddingConfig();
  return {
    ...DEFAULT_CONFIG,
    ...embeddingDefaults,
    ...overrides,
  };
}

export async function writeTestConfig(repoRoot, overrides = {}) {
  const config = buildTestConfig(overrides);
  await fs.writeFile(
    path.join(repoRoot, "dryconfig.json"),
    JSON.stringify(config, null, 2),
    "utf8"
  );
  return config;
}
