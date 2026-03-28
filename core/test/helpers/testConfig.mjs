import fs from "fs/promises";
import path from "path";
import { DEFAULT_CONFIG } from "../../src/config/dryconfig.ts";

/**
 * Returns embedding config for tests.
 * Uses HuggingFace by default (via DEFAULT_CONFIG).
 */
function baseEmbeddingConfig() {
  return {
    embeddingSource: DEFAULT_CONFIG.embeddingSource,
  };
}

export function buildTestConfig(overrides = {}) {
  const embeddingDefaults = baseEmbeddingConfig();
  return {
    ...DEFAULT_CONFIG,
    ...embeddingDefaults,
    // Disable LLM filter by default in tests — it requires a live Ollama instance
    // and would make every unit test hit the network. Tests that specifically test
    // LLM filtering pass { enableLLMFilter: true } as an override.
    enableLLMFilter: false,
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
