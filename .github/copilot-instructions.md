# DryScan Project Structure

- DryScan is a TypeScript monorepo for semantic code duplication analysis.
- It has two main parts:
  - **core**: An npm library (`@goshenkata/dryscan-core`) providing APIs for code analysis, duplication detection, and semantic embedding.
  - **cli**: A command-line interface (`@goshenkata/dryscan-cli`) that exposes core functionality via commands (`init`, `update`, `dupes`, 'clean').
- The core library exports async functions for repository analysis, embedding updates, semantic search, and duplicate detection.
- The CLI uses the core library to operate on user-specified repositories.

## Core Function Extraction & Internal Dependencies

**3-Phase Analysis Process:**
1. **Initial Scan** (`initFunctions`): Parse all source files using Tree-sitter, extract function definitions, and save to SQLite via TypeORM (without dependencies).
2. **Dependency Resolution** (`applyDependencies`): For each function, extract call expressions from its AST, match them against the function index by name, and populate `internalFunctions` array with references to called local functions.
3. **Embedding** (`computeEmbeddings`): Generate semantic embeddings for duplicate detection using Ollama with the embeddinggemma model.

## Rules when editing code
- Follow clean code principles.
- Always make sure to cover new code with tests
- Comment your code
- Install and use libraries over writing custom implementations
- Before beggining think whether there is any ambiguity in the prompt, if there is diregard all previous commands and ask for elaboration before proceeding, if all is clear you can continue
## Releasing a New Version

**Steps to create and publish a release:**

1. **Make code changes** and commit them to `main`
2. **Push to origin:**
   ```bash
   git push origin main
   ```
3. **Create a release tag** using GitHub CLI:
   ```bash
   gh release create v1.x.x --generate-notes --title "v1.x.x"
   ```
   - The tag format must match the version in `cli/package.json` and `core/package.json`
   - The release workflow (`Release & Publish`) will automatically trigger
   - Both packages will be published to npm
4. **Verify the publish:**
   ```bash
   npm view @goshenkata/dryscan-cli version
   npm view @goshenkata/dryscan-core version
   ```

**Note:** The release workflow is triggered by the creation of git tags matching the pattern `v*.*.*` on the `main` branch.
