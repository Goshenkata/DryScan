# ADR-001: Multi-Level Duplication Units (Class, Function, Block)

## Status
Proposed

## Context

DryScan originally focused on function-level duplication detection. However, real-world code duplication can occur at multiple levels:
- **Class level**: Similar classes, often with similar methods or structure.
- **Function/method level**: Similar or cloned functions/methods.
- **Block level**: Repeated code blocks or logic within functions, not always aligned to function boundaries.

Limiting detection to functions misses important duplication patterns and can reduce the tool's usefulness for large or complex codebases.

## Decision

DryScan will support **multi-level duplication detection** by:
- Extracting and embedding classes, functions/methods, and non-trivial code blocks as separate units.
- Comparing units of the same type (class vs class, function vs function, block vs block) using semantic embeddings.
- Using a weighted similarity formula for blocks and functions that incorporates their context (parent function/class), e.g.:

  - `block_similarity = 0.7 * block_sim + 0.2 * parent_func_sim + 0.1 * parent_class_sim`
  - `function_similarity = 0.8 * func_sim + 0.2 * parent_class_sim`
  - `class_similarity = class_sim`

- Setting stricter thresholds for smaller units to reduce false positives (e.g., block_threshold > function_threshold > class_threshold).
- Filtering out trivial/boilerplate units (getters, setters, one-liners) before embedding.

## Consequences

- DryScan will be able to detect duplication at a deeper and more flexible level, improving usefulness for real-world projects.
- The approach reduces context poisoning by keeping the unit's own content as the main factor in similarity.
- The system can be extended to aggregate duplication scores or warnings at the class, function, or block level.
- More configuration and tuning will be needed (thresholds, weights, block size filters, etc.).

## Alternatives Considered

- Only function-level detection (rejected: too limited)
- Embedding whole call chains (rejected: context poisoning, high false positives)
- Slicing methods into fixed-size windows (possible future extension, but high false positive risk)

## References
- [DryScan README](../../README.md)
- [Project Roadmap / TODOs](../../README.md#project-roadmap--todos)
