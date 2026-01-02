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
  "embeddingModel": "embeddinggemma",
  "embeddingSource": "http://localhost:11434",
  "excludedPaths": ["**/test/**"]
}
```

**Embedding Providers:**
- Ollama (default): `"embeddingSource": "http://localhost:11434"`
- Google Gemini: `"embeddingSource": "google"` (requires `GOOGLE_API_KEY` env var set)

## Supported languages**

Just java for now

## License

MIT
