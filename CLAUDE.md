# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies (run from repo root)
npm install

# Full reinstall (use when native modules break or after switching branches)
rm -rf node_modules core/node_modules cli/node_modules package-lock.json && npm install

# Build all packages
npm run build

# Build a specific workspace
npm run build --workspace @goshenkata/dryscan-core
npm run build --workspace @goshenkata/dryscan-cli

# Run all tests
npm run test

# Run core tests only (Mocha unit tests)
npm run test --workspace @goshenkata/dryscan-core

# Run CLI tests (unit + bats integration)
npm run test --workspace @goshenkata/dryscan-cli
npm run test:unit --workspace @goshenkata/dryscan-cli
npm run test:bats --workspace @goshenkata/dryscan-cli

# Run a single test file
tsx node_modules/mocha/bin/mocha "core/test/duplicates.test.mjs"

# Lint
npm run lint

# Run CLI in dev mode (no build needed)
npm run dryscan:dev -- <args>

# Run built CLI
npm run dryscan -- <args>
```

## Architecture

This is an npm workspaces monorepo with three packages:

- **`core/`** (`@goshenkata/dryscan-core`) — Core library. Contains all analysis logic. Published to npm.
- **`cli/`** (`@goshenkata/dryscan-cli`) — Commander-based CLI wrapper over core. Published to npm.
- **`vscode-extension/`** (`@goshenkata/dryscan-vscode-extension`) — VS Code extension using core.

### Analysis Pipeline (core)

1. **`IndexUnitExtractor`** — Walks the repo, delegates to `LanguageExtractor` implementations (currently only `JavaExtractor` via `tree-sitter-java`) to parse source into `IndexUnit` objects (class/function/block).

2. **`DryScanDatabase`** — SQLite via TypeORM. Stores `IndexUnitEntity` and `FileEntity`. Located at `<repo>/.dry/index.db`.

3. **`EmbeddingService`** — Generates vector embeddings per `IndexUnit`. Supports Ollama (URL config) and HuggingFace Inference API (`huggingface` config). Uses `qwen3-embedding:0.6b` model.

4. **`DuplicateService`** — Compares all unit pairs using cosine similarity on cached embeddings (`DuplicationCache`). Applies per-type thresholds (function/block/class). Reuses clean-pair results from the previous report when only some files changed (incremental optimization).

5. **`DryScan`** — Top-level facade. Orchestrates `init` (3-phase: extract → resolve deps → embed), `updateIndex` (incremental), and `buildDuplicateReport`.

### Key Config

`dryconfig.json` at repo root controls analysis:
- `embeddingSource`: Ollama URL (e.g. `http://localhost:11434`) or `"huggingface"`
- `threshold`: cosine similarity threshold (0–1, default 0.8)
- `contextLength`: max chars for embedding (default 2048)
- `excludedPaths`: glob patterns to skip
- `excludedPairs`: specific unit pair IDs to ignore
- `minLines` / `minBlockLines`: minimum unit size

### Data Flow

```
Source files → IndexUnitExtractor → IndexUnit[]
                                          ↓
                               DryScanDatabase (SQLite)
                                          ↓
                               EmbeddingService (Ollama/HF)
                                          ↓
                               DuplicationCache (in-memory similarity matrix)
                                          ↓
                               DuplicateService → DuplicateReport (.dry/reports/)
```

### Adding a Language

Implement `LanguageExtractor` (in `core/src/extractors/LanguageExtractor.ts`) and add it to `defaultExtractors()` in `IndexUnitExtractor.ts`. The Java extractor (`core/src/extractors/java.ts`) is the reference implementation using `tree-sitter`.

### Debug Logging

Uses the `debug` package. Enable with:
```bash
DEBUG=DryScan:* npm run dryscan -- dupes .
```

### Windows / Git Bash Notes

- `tree-sitter` is pinned to `~0.21.1` because v0.25.0 dropped prebuilt binaries from the npm package and requires a C++ toolchain (Visual Studio Build Tools) to compile via node-gyp. Version 0.21.1 ships win32-x64 prebuilds that work out of the box.
- If native modules break, do a full reinstall: `rm -rf node_modules core/node_modules package-lock.json && npm install`
- The CLI build script uses `node -e` for file copies to stay cross-platform (cmd.exe does not have `chmod` or Unix `cp`).
