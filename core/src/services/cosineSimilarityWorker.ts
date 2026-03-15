import { parentPort, workerData } from "node:worker_threads";
import { cosineSimilarity } from "@langchain/core/utils/math";

const { rowsBuffer, rowCount, allBuffer, allCount, dims, resultBuffer, startRow } = workerData as {
  rowsBuffer: ArrayBuffer;
  rowCount: number;
  /** SharedArrayBuffer for matrix B (input), shared across all workers. */
  allBuffer: SharedArrayBuffer;
  allCount: number;
  dims: number;
  /** SharedArrayBuffer for result matrix, where this worker writes its rows. */
  resultBuffer: SharedArrayBuffer;
  startRow: number;
};

const toMatrix = (buf: ArrayBuffer | SharedArrayBuffer, count: number): number[][] =>
  Array.from({ length: count }, (_, i) =>
    Array.from(new Float64Array(buf, i * dims * 8, dims))
  );

// Compute similarity for this chunk
const chunkA = toMatrix(rowsBuffer, rowCount);
const matrixB = toMatrix(allBuffer, allCount);
const result = cosineSimilarity(chunkA, matrixB);

// Write results directly to the shared result buffer
const resultView = new Float64Array(resultBuffer);
for (let i = 0; i < result.length; i++) {
  for (let j = 0; j < result[i].length; j++) {
    resultView[(startRow + i) * allCount + j] = result[i][j];
  }
}

// Signal completion
parentPort!.postMessage({ done: true });
