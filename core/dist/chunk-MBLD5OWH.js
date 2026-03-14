var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

// src/services/ParallelSimilarity.ts
import os from "os";
import { Worker } from "worker_threads";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { cosineSimilarity } from "@langchain/core/utils/math";
var MIN_PARALLEL_ROWS = 50;
async function parallelCosineSimilarity(A, B) {
  if (A.length === 0 || B.length === 0) return [];
  if (A.length < MIN_PARALLEL_ROWS) return cosineSimilarity(A, B);
  const dims = A[0].length;
  const chunkSize = Math.ceil(A.length / os.cpus().length);
  const sharedB = new SharedArrayBuffer(B.length * dims * 8);
  const bView = new Float64Array(sharedB);
  B.forEach((row, i) => bView.set(row, i * dims));
  const runningTsSource = new URL(import.meta.url).pathname.endsWith(".ts");
  const workerCandidates = runningTsSource ? ["./cosineSimilarityWorker.ts", "./services/cosineSimilarityWorker.ts"] : ["./cosineSimilarityWorker.js", "./services/cosineSimilarityWorker.js"];
  const workerUrl = workerCandidates.map((candidate) => new URL(candidate, import.meta.url)).find((url) => existsSync(fileURLToPath(url)));
  if (!workerUrl) {
    throw new Error(
      `cosineSimilarityWorker not found next to ${fileURLToPath(new URL(import.meta.url))}. Tried: ${workerCandidates.join(", ")}`
    );
  }
  const execArgv = runningTsSource ? ["--import", "tsx/esm"] : [];
  const chunks = Array.from(
    { length: Math.ceil(A.length / chunkSize) },
    (_, i) => A.slice(i * chunkSize, (i + 1) * chunkSize)
  );
  const results = await Promise.all(chunks.map((chunk) => runWorker(chunk, sharedB, B.length, dims, workerUrl, execArgv)));
  return results.flat();
}
function runWorker(chunk, sharedB, bCount, dims, workerUrl, execArgv) {
  return new Promise((resolve, reject) => {
    const rowsFlat = new Float64Array(chunk.length * dims);
    chunk.forEach((row, i) => rowsFlat.set(row, i * dims));
    const worker = new Worker(workerUrl, {
      workerData: { rowsBuffer: rowsFlat.buffer, rowCount: chunk.length, allBuffer: sharedB, allCount: bCount, dims },
      transferList: [rowsFlat.buffer],
      execArgv
    });
    worker.once("message", ({ result }) => resolve(result));
    worker.once("error", reject);
  });
}
var similarityApi = {
  parallelCosineSimilarity
};

export {
  __decorateClass,
  parallelCosineSimilarity,
  similarityApi
};
//# sourceMappingURL=chunk-MBLD5OWH.js.map