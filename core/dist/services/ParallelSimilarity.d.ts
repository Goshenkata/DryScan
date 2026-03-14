/**
 * Computes cosine similarity using a deterministic backend chain.
 * Default chain: GPU -> worker threads -> synchronous fallback.
 */
declare function parallelCosineSimilarity(A: number[][], B: number[][]): Promise<number[][]>;

export { parallelCosineSimilarity };
