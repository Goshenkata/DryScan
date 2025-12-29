# ADR-003: Configurable .dryconfig Exclusions, Thresholds, and Cleaning

## Status
Accepted

## Context
DryScan needed a user-facing way to tune noise reduction without code changes: skip known noisy paths, suppress specific duplicate pairs, and adjust sensitivity (thresholds and size limits). Previously, indexing always processed all supported files, thresholds were fixed in code, and exclusions were ad hoc. We also lacked a mechanism to prune stale exclusions after refactors.

## Decision
- Add a repository-level `.dryconfig.json` read by core/CLI containing:
  - `excludedPaths` (globs) to skip during extraction and to remove from the DB after init/update.
  - `excludedPairs` strings representing class/function/block pairs to suppress in `dupes`.
  - `maxLines`, `maxBlockLines` to cap indexed classes/functions/blocks; `threshold` to override default duplicate threshold.
- Define canonical pair keys per unit type:
  - Class: repo-relative file paths (glob-matchable).
  - Function: canonical signature string with arity.
  - Block: normalized (comments/whitespace-stripped) hash of the block code.
- Apply exclusions when emitting duplicates; maintain order-insensitive matching.
- Add `dryscan clean` to drop `excludedPairs` that no longer match any indexed units after an `update`.
- Threshold priority: CLI arg > `.dryconfig.json` > built-in defaults.

## Consequences
- Users can declaratively suppress false positives and tune sensitivity without code changes.
- Indexing work is reduced by skipping excluded paths and large units beyond configured limits.
- Exclusion entries remain stable across runs and can be cleaned automatically when they become stale.
- Slightly more configuration surface area; misconfigured globs/regex-like patterns could hide real duplicates, so matching is kept canonical and deterministic.

## Notes
- Pair-key computation and exclusion matching are centralized to keep CLI/core behavior consistent.
- Config loading is best-effort; missing `.dryconfig.json` falls back to safe defaults.
