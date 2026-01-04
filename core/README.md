# @goshenkata/dryscan-core

Core library for DryScan - semantic code duplication analyzer using embeddings.

## Installation

```bash
npm install @goshenkata/dryscan-core
```

## Usage

### Basic Example

```typescript
import { DryScan } from '@goshenkata/dryscan-core';

const scanner = new DryScan('/path/to/your/repository');

// Initialize repository index
await scanner.init();

// Build duplicate analysis report
const report = await scanner.buildDuplicateReport();

console.log(`Duplication Score: ${report.score.score}`);
console.log(`Found ${report.duplicates.length} duplicate pairs`);
```

### API

Initializes the repository with a 3-phase analysis:
1. Extract and index all code units (functions, methods, blocks)
2. Resolve internal dependencies
3. Compute semantic embeddings

#### `async updateIndex(): Promise<void>`

Incrementally updates the index by detecting changed, new, and deleted files. Only reprocesses modified units for efficiency.

```typescript
await scanner.updateIndex();
```

#### `async buildDuplicateReport(): Promise<DuplicateReport>`

Runs duplicate detection and returns a comprehensive report with similarity scores and duplication metrics.

```typescript
const report = await scanner.buildDuplicateReport();

report.duplicates.forEach(dup => {
  console.log(`${dup.similarity.toFixed(2)} - ${dup.left.name} ↔ ${dup.right.name}`);
});
```

#### `async cleanExclusions(): Promise<{ removed: number; kept: number }>`

Removes stale exclusion rules that no longer match any indexed units.

```typescript
const result = await scanner.cleanExclusions();
console.log(`Cleaned ${result.removed} stale exclusions`);
```

### Configuration

Place a `dryconfig.json` in your repository root:

```json
{
  "threshold": 0.88,
  "minLines": 5,
  "minBlockLines": 8,
  "embeddingSource": "huggingface",
  "excludedPaths": ["**/test/**", "**/node_modules/**"],
  "excludedPairs": []
}
```

**Supported Embedding Providers:**
- **HuggingFace** (default): Set `embeddingSource` to `"huggingface"` (requires `HUGGINGFACEHUB_API_KEY` env var)
- **Ollama** (local): Set `embeddingSource` to an Ollama URL like `"http://localhost:11434"`

## Requirements

- Node.js >= 18.0.0
- HuggingFace API key (default) or Ollama running locally for embeddings

## Supported languages**

Just java for now
## License

MIT
