# Code Smells Report

This document outlines code smells identified in the DryScan repository, ranked by impact.

## 🔴 High Impact
*Pervasive issues, architectural flaws, significant code duplication, or potential bugs.*

### 1. Significant Code Duplication in Extractors
The `JavaExtractor` and `JavaScriptExtractor` classes share a substantial amount of logic (approx. 80%). Methods like `extractFromText`, `visit`, `buildId`, `buildFunctionUnit`, `extractBlocks`, and `stripClassBody` are nearly identical, differing mainly in Tree-sitter node type names.

**Files:**
- [core/src/extractors/java.ts](core/src/extractors/java.ts)
- [core/src/extractors/javascript.ts](core/src/extractors/javascript.ts)

**Recommendation:**
Refactor the common logic into an abstract base class (e.g., `AbstractTreeSitterExtractor`) or use a composition strategy. The base class can handle the traversal and structure building, while subclasses provide language-specific configuration (node types, query patterns).

### 2. Hardcoded Embedding Configuration
The embedding model (`embeddinggemma`) and the default Ollama URL are hardcoded deep within the `DryScanUpdater` module. This prevents users from configuring different models or providers without modifying the source code.

**File:**
- [core/src/DryScanUpdater.ts](core/src/DryScanUpdater.ts#L170-L173)

```typescript
const embeddings = new OllamaEmbeddings({
  model: "embeddinggemma", // Hardcoded
  baseUrl: process.env.OLLAMA_API_URL || "http://localhost:11434",
});
```

**Recommendation:**
Move these settings to `DryConfig` or `indexConfig`. Allow the user to specify the model name and API URL in their `.dryconfig.json`.

### 3. Fragile Triviality Checks via Regex
The `triviality.ts` module uses Regular Expressions to parse and analyze code for triviality (e.g., getters/setters). Since the project already uses Tree-sitter for parsing, relying on Regex on raw source strings is fragile, error-prone, and ignores the robust AST already available.

**File:**
- [core/src/extractors/triviality.ts](core/src/extractors/triviality.ts#L44-L70)

**Recommendation:**
Implement triviality checks using the Tree-sitter AST nodes within the extractors, or pass the AST node to the triviality checker instead of the raw code string.

---

## 🟡 Medium Impact
*Localized code duplication, flexibility limits, or confusing logic.*

### 4. "God Class" `DryScan`
The `DryScan` class is becoming a "God Class," handling initialization, updates, duplicate finding, exclusion cleaning, and file tracking. This violates the Single Responsibility Principle.

**File:**
- [core/src/DryScan.ts](core/src/DryScan.ts)

**Recommendation:**
Break down `DryScan` into smaller, focused service classes, such as `RepositoryInitializer`, `IndexUpdater`, `DuplicateFinder`, and `ExclusionManager`. `DryScan` can remain as a facade if needed.

### 5. Code Duplication in Database Layer
The `DryScanDatabase` class contains repetitive methods for saving and updating entities. `saveUnit`, `saveUnits`, `updateUnit`, and `updateUnits` are functionally identical or very similar.

**File:**
- [core/src/db/DryScanDatabase.ts](core/src/db/DryScanDatabase.ts#L34-L65)

**Recommendation:**
Consolidate these methods. `TypeORM`'s `save` method handles both insertion and update. You can have a generic `save<T>` method or just `saveUnits` that handles both single and array inputs.

### 6. Implicit Dependency on Default Extractors
The `IndexUnitExtractor` class defaults to creating specific instances of `JavaScriptExtractor` and `JavaExtractor` in its constructor or via a helper. This couples the core extractor logic to specific language implementations.

**File:**
- [core/src/IndexUnitExtractor.ts](core/src/IndexUnitExtractor.ts#L17)

**Recommendation:**
Use dependency injection. The `IndexUnitExtractor` should receive a list of `LanguageExtractor` instances and not know about concrete classes like `JavaExtractor`.

### 7. Inconsistent Error Handling
Error handling is inconsistent. Some methods log and swallow errors, while others rethrow. Specifically, `loadDryConfig` might crash the application if the config file contains invalid JSON (syntax error), as it only catches `ENOENT` effectively (rethrowing others).

**Files:**
- [core/src/config/dryconfig.ts](core/src/config/dryconfig.ts#L56)
- [core/src/DryScan.ts](core/src/DryScan.ts)

**Recommendation:**
Standardize error handling. Ensure `loadDryConfig` gracefully handles JSON parse errors. Decide on a strategy for logging vs. throwing in the core library.

---

## 🟢 Low Impact
*Minor style issues, small refactoring opportunities, magic values.*

### 8. Magic Strings and Numbers
There are numerous magic strings (e.g., "md5", "sha1", node types) and numbers (ports, thresholds) scattered throughout the code.

**Files:**
- [core/src/extractors/java.ts](core/src/extractors/java.ts) (Node types)
- [core/src/pairs.ts](core/src/pairs.ts) ("sha1")
- [cli/src/cli.ts](cli/src/cli.ts) (Port 3000)

**Recommendation:**
Extract these into constants or configuration files.

### 9. Long Functions
Some functions are excessively long and do too much, making them hard to read and test.
- `dupes` command action in [cli/src/cli.ts](cli/src/cli.ts#L136)
- `init` method in [core/src/DryScan.ts](core/src/DryScan.ts#L51)

**Recommendation:**
Extract helper functions or move logic to dedicated service classes.

### 10. Type Safety and `@ts-ignore`
There are usages of `@ts-ignore` for `tree-sitter` language bindings and some `any` types.

**Files:**
- [core/src/extractors/java.ts](core/src/extractors/java.ts#L3)
- [core/src/extractors/javascript.ts](core/src/extractors/javascript.ts#L3)

**Recommendation:**
Try to find or create proper type definitions for these modules to improve type safety.
