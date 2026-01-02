# DryScan
A Semantic Code Duplication & Reuse Analyzer

## Architecture

This monorepo contains:

- **`@goshenkata/dryscan-core`** - Core library
- **`@goshenkata/dryscan-cli`** - Command-line interface
- **`@goshenkata/dryscan-vscode-extension`** - VScode extension

## Installation

```bash
# Clone the repository
git clone https://github.com/Goshenkata/DryScan.git
cd DryScan

# Install dependencies
npm install

# Build all packages
npm run build
```

## Usage

### CLI Commands

```bash
# Initialize config and embeddings
dryscan init 

# Update embeddings for semantic search
dryscan update

# Find duplicate code patterns
dryscan dupes <repo-path>
```

Embeddings: set `embeddingSource` in `dryconfig.json` to `google` to use Gemini (requerest setting a GOOGLE_API_KEY env var), 
or provide an Ollama URL to use local embeddings;

## Project Roadmap / TODOs
 - [ ] **ROAMAP**
	- [x] [ADR-001: Multi-level duplication units (class, function, block)](.github/docs/adr-001-multilevel-duplication-units.md)
	- [x] [ADR-002: AI triviality detection](.github/docs/adr-002-static-triviality-filtering.md)
    - [x] add dryscan config
	- [x] Compute Duplication score
	- [x] Refacor for maintainability
	- [x] Write integration tests
	- [x] Fix model context winow issue for large files
	- [x] Caching of comparisons
	- [x] remove of nesting blocks from comparison

- [ ] **VS Code Extension**
	- [ ] Inline duplicate highlighting
	- [ ] Show duplication score in editor
	- [ ] Model switch UI
	- [ ] Quick ignore/add to .dryignore

- [ ] **CI/CD Tools**
	- [ ] Dockerized CLI
	- [X] Cloud AI
	- [ ] GitHub Action
	- [ ] Failure thresholds (block PRs)
	- [ ] Duplication score in CI reports

- [ ] **Nice to have**
	- [ ] Refactoring suggestions - vscode
	- [ ] Cross-repo analysis 

## License

MIT - see [LICENSE](LICENSE) file for details.
