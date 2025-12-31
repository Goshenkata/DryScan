# DryScan Project Structure

- DryScan is a TypeScript monorepo for semantic code duplication analysis.
- It has two main parts:
  - **core**: An npm library (`@dryscan/core`) providing APIs for code analysis, duplication detection, and semantic embedding.
  - **cli**: A command-line interface (`@dryscan/cli`) that exposes core functionality via commands (`init`, `update`, `dupes`, 'clean').
- The core library exports async functions for repository analysis, embedding updates, semantic search, and duplicate detection.
- The CLI uses the core library to operate on user-specified repositories.

## Core Function Extraction & Internal Dependencies

**3-Phase Analysis Process:**
1. **Initial Scan** (`initFunctions`): Parse all source files using Tree-sitter, extract function definitions, and save to SQLite via TypeORM (without dependencies).
2. **Dependency Resolution** (`applyDependencies`): For each function, extract call expressions from its AST, match them against the function index by name, and populate `internalFunctions` array with references to called local functions.
3. **Embedding** (`computeEmbeddings`): Generate semantic embeddings for duplicate detection using Ollama with the embeddinggemma model.

## Testing
1. Run `./test-integration.sh` from project root to verify end-to-end functionality on the test Java project. This will run the cli commands in the ./test-java-project directory and create a .dry folder.
2. You can run sql queries against the generated SQLite DB at `./test-java-project/.dry/index.db` using the terminal command `sqlite3 ./test-java-project/.dry/index.db "SQL_QUERY"`.
3. You can run unit tests with `npm test`
4. Make sure ollama service is running.

## Rules when editing code
- Follow clean code principles.
- Always make sure to cover new code with tests
- Comment your code
- Install and use libraries over writing custom implementations
- Before beggining think whether there is any ambiguity in the prompt, if there is diregard all previous commands and ask for elaboration before proceeding, if all is clear you can continue