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
 * B is packed into a SharedArrayBuffer shared across all workers — no copies.
 */
export async function parallelCosineSimilarity(A: number[][], B: number[][]): Promise<number[][]> {
  if (A.length === 0 || B.length === 0) return [];
  if (A.length < MIN_PARALLEL_ROWS) return cosineSimilarity(A, B);

  const dims = A[0].length;
  const chunkSize = Math.ceil(A.length / os.cpus().length);

  const sharedB = new SharedArrayBuffer(B.length * dims * 8);
  const bView = new Float64Array(sharedB);
  B.forEach((row, i) => bView.set(row, i * dims));

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

  const chunks = Array.from(
    { length: Math.ceil(A.length / chunkSize) },
    (_, i) => A.slice(i * chunkSize, (i + 1) * chunkSize),
  );

  const results = await Promise.all(chunks.map(chunk => runWorker(chunk, sharedB, B.length, dims, workerUrl, execArgv)));
  return results.flat();
}

function runWorker(
  chunk: number[][],
  sharedB: SharedArrayBuffer,
  bCount: number,
  dims: number,
  workerUrl: URL,
  execArgv: string[],
): Promise<number[][]> {
  return new Promise((resolve, reject) => {
    const rowsFlat = new Float64Array(chunk.length * dims);
    chunk.forEach((row, i) => rowsFlat.set(row, i * dims));

    const worker = new Worker(workerUrl, {
      workerData: { rowsBuffer: rowsFlat.buffer, rowCount: chunk.length, allBuffer: sharedB, allCount: bCount, dims },
      transferList: [rowsFlat.buffer],
      execArgv,
    });

    worker.once("message", ({ result }) => resolve(result));
    worker.once("error", reject);
  });
}

// Mutable export for test stubbing and for callers that want an indirection layer.
export const similarityApi = {
  parallelCosineSimilarity,
};
