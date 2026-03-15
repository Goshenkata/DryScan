import os from "node:os";
import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cosineSimilarity } from "@langchain/core/utils/math";

/** Minimum row count below which synchronous is faster than worker overhead. */
const MIN_PARALLEL_ROWS = 50;

/**
 * Computes cosineSimilarity(A, B) using worker threads for large inputs,
 * falling back to the synchronous library call for small ones.
 * B and the result matrix are both in SharedArrayBuffer — no serialization needed.
 */
export async function parallelCosineSimilarity(A: number[][], B: number[][]): Promise<number[][]> {
  if (A.length === 0 || B.length === 0) return [];
  if (A.length < MIN_PARALLEL_ROWS) return cosineSimilarity(A, B);

  const dims = A[0].length;
  const chunkSize = Math.ceil(A.length / os.cpus().length);

  const sharedB = new SharedArrayBuffer(B.length * dims * 8);
  const bView = new Float64Array(sharedB);
  B.forEach((row, i) => bView.set(row, i * dims));

  // Allocate SharedArrayBuffer for output matrix (A.length × B.length).
  // Workers write directly to this instead of serializing results.
  const sharedResult = new SharedArrayBuffer(A.length * B.length * 8);

  const runningTsSource = new URL(import.meta.url).pathname.endsWith('.ts');

  const workerCandidates = runningTsSource
    ? ['./cosineSimilarityWorker.ts', './services/cosineSimilarityWorker.ts']
    : ['./cosineSimilarityWorker.js', './services/cosineSimilarityWorker.js'];

  const workerUrl = workerCandidates
    .map((candidate) => new URL(candidate, import.meta.url))
    .find((url) => existsSync(fileURLToPath(url)));

  if (!workerUrl) {
    throw new Error(
      `cosineSimilarityWorker not found next to ${fileURLToPath(new URL(import.meta.url))}. Tried: ${workerCandidates.join(", ")}`
    );
  }

  const execArgv = runningTsSource ? ['--import', 'tsx/esm'] : [];

  // Create chunks with their row offsets in the output matrix
  let rowOffset = 0;
  const chunks = Array.from(
    { length: Math.ceil(A.length / chunkSize) },
    (_, i) => {
      const chunk = A.slice(i * chunkSize, (i + 1) * chunkSize);
      const startRow = rowOffset;
      rowOffset += chunk.length;
      return { chunk, startRow };
    }
  );

  await Promise.all(
    chunks.map(({ chunk, startRow }) =>
      runWorker(chunk, sharedB, B.length, dims, sharedResult, startRow, workerUrl, execArgv)
    )
  );

  // Convert SharedArrayBuffer back to regular array of arrays
  const resultView = new Float64Array(sharedResult);
  const result: number[][] = [];
  for (let i = 0; i < A.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < B.length; j++) {
      row.push(resultView[i * B.length + j]);
    }
    result.push(row);
  }
  return result;
}

function runWorker(
  chunk: number[][],
  sharedB: SharedArrayBuffer,
  bCount: number,
  dims: number,
  sharedResult: SharedArrayBuffer,
  startRow: number,
  workerUrl: URL,
  execArgv: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const rowsFlat = new Float64Array(chunk.length * dims);
    chunk.forEach((row, i) => rowsFlat.set(row, i * dims));

    const worker = new Worker(workerUrl, {
      workerData: {
        rowsBuffer: rowsFlat.buffer,
        rowCount: chunk.length,
        allBuffer: sharedB,
        allCount: bCount,
        dims,
        resultBuffer: sharedResult,
        startRow,
      },
      transferList: [rowsFlat.buffer],
      execArgv,
    });

    worker.once("message", () => resolve());
    worker.once("error", reject);
  });
}

// Mutable export for test stubbing and for callers that want an indirection layer.
export const similarityApi = {
  parallelCosineSimilarity,
};
