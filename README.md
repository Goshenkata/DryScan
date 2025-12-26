# DryScan
A Semantic Code Duplication & Reuse Analyzer

DryScan is a TypeScript monorepo that provides semantic analysis of codebases to detect code duplication and enable intelligent code reuse patterns.

## Architecture

This monorepo contains two main packages:

- **`@dryscan/core`** - Core library with analysis functions
- **`@dryscan/cli`** - Command-line interface

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
# Initialize analysis for a repository
npx dryscan init <repo-path>

# Update embeddings for semantic search
npx dryscan update <repo-path>

# Find duplicate code patterns
npx dryscan dupes <repo-path>
```

### Examples

```bash
# Analyze the current directory
npx dryscan init .

# Search for authentication-related code
npx dryscan search "authentication" --repo ./my-project

# Find duplicates in a specific project
npx dryscan dupes ./src
```

## Core Library

The `@dryscan/core` package exports the following async functions:

- `analyzeRepo(repoPath: string)` - Analyzes repository structure and code
- `findDuplicates(repoPath: string)` - Detects code duplication patterns

## Development

```bash
# Build all packages
npm run build

# Clean build artifacts
npm run clean

# Watch mode for development
npm run dev
```

## Requirements

- Node.js >= 18.0.0
- TypeScript 5.3+

## License

MIT - see [LICENSE](LICENSE) file for details.
