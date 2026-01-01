# ADR-004: Handling Embeddings When Code Exceeds Context Length

## Status
Accepted

## Context
- Some index units (classes/functions/blocks) can exceed the embedding model context window.
- Current schema stores a single embedding per `IndexUnitEntity` and allows `embedding` to be null.
- Duplicate detection uses embeddings to compute similarity and thresholds across unit types.

## Decision
- Add a configurable `contextLength` (default 2048) to `dryconfig.json`.
- Skip embedding any unit whose `code` length exceeds `contextLength`; store `embedding = null` and log the skip.
- When an embedding is null, compute similarity by comparing children (including slice children created for oversized blocks) and taking the best match; parent similarity also uses the same fallback.
- Keep thresholds/weights logic unchanged; only the similarity source changes (direct vector vs child fallback).

## Consequences
- Large units no longer fail embedding; they are represented via their embedded descendants.
- Duplicate detection can still surface matches for oversized units through child/slice similarity, with consistent thresholds.
- Storage schema remains unchanged (nullable embedding); new behavior is driven by config and similarity fallback logic.
- Users can tune `contextLength` per repo; lowering it trades embedding cost for more child-based comparisons.
