/**
 * Computes cosineSimilarity(A, B) using worker threads for large inputs,
 * falling back to the synchronous library call for small ones.
 * B and the result matrix are both in SharedArrayBuffer — no serialization needed.
 */
declare function parallelCosineSimilarity(A: number[][], B: number[][]): Promise<number[][]>;
declare const similarityApi: {
    parallelCosineSimilarity: typeof parallelCosineSimilarity;
};

export { parallelCosineSimilarity, similarityApi };
