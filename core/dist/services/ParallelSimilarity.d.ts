type DType = "float32" | "float64";
type FlatCosineMatrix = {
    data: Float32Array | Float64Array;
    rows: number;
    cols: number;
};
/**
 * Computes cosineSimilarity(A, B) into a flat typed-array (row-major) using workers.
 * This avoids allocating a massive number[][] which will OOM for large matrices.
 */
declare function parallelCosineSimilarityFlat(A: number[][], B: number[][], dtype?: DType): Promise<FlatCosineMatrix>;
/**
 * Computes cosineSimilarity(A, B) using worker threads for large inputs,
 * falling back to the synchronous library call for small ones.
 * B and the result matrix are both in SharedArrayBuffer — no serialization needed.
 */
declare function parallelCosineSimilarity(A: number[][], B: number[][]): Promise<number[][]>;
declare const similarityApi: {
    parallelCosineSimilarity: typeof parallelCosineSimilarity;
    parallelCosineSimilarityFlat: typeof parallelCosineSimilarityFlat;
};

export { type FlatCosineMatrix, parallelCosineSimilarity, parallelCosineSimilarityFlat, similarityApi };
