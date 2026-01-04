# @goshenkata/dryscan-cli

CLI for DryScan - semantic code duplication analyzer.

## Installation

```bash
npm install -g @goshenkata/dryscan-cli
```

## Usage

```bash
# Initialize repository
dryscan init

# Find duplicates
dryscan dupes              # Text report
dryscan dupes --json       # JSON output
dryscan dupes --ui         # Web UI at http://localhost:3000

# Update index after changes
dryscan update

# Exclude duplicate by short ID
dryscan dupes exclude abc123

# Clean stale exclusions
dryscan clean
```

## Configuration

Create `dryconfig.json` in your repository root:

```json
{
  "threshold": 0.88,
  "minLines": 5,
  "embeddingSource": "huggingface",
  "excludedPaths": ["**/test/**"]
}
```

**Embedding Providers:**
- HuggingFace (default): `"embeddingSource": "huggingface"` (requires `HUGGINGFACEHUB_API_KEY` env var)
- Ollama (local): `"embeddingSource": "http://localhost:11434"`

## Supported languages**

Just java for now

## License

MIT
