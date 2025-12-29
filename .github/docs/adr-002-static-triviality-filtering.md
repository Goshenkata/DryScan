# ADR-002: Static Triviality Filtering for Boilerplate

## Status
Accepted

## Context
Duplicate detection surfaced many false positives from trivial code (getters, setters, one-liners) that are structurally similar but semantically meaningless for duplication insights. An LLM-based classifier was considered but would add latency, cost, external dependencies, and nondeterministic behavior. We need a fast, deterministic way to suppress boilerplate across languages (Java, JavaScript/TypeScript) and keep results stable for CI and local runs.

## Decision
Implement static triviality filtering inside each language extractor. A small, shared heuristic screens out obvious accessors and one-liners before embedding and comparison. This keeps the pipeline deterministic and cheap while being easy to tune per extractor.

## Consequences
- **Pros:** Fewer boilerplate false positives; deterministic and fast; no new external services; easy to extend per language.
- **Cons:** Heuristics may miss some trivial patterns or over-filter rare meaningful one-liners; future tuning may be needed.
