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
function resolveWorkerUrl() {
  const runningTsSource = new URL(import.meta.url).pathname.endsWith(".ts");
  const workerCandidates = runningTsSource ? ["./cosineSimilarityWorker.ts", "./services/cosineSimilarityWorker.ts"] : ["./cosineSimilarityWorker.js", "./services/cosineSimilarityWorker.js"];
  const workerUrl = workerCandidates.map((candidate) => new URL(candidate, import.meta.url)).find((url) => existsSync(fileURLToPath(url)));
  if (!workerUrl) {
    throw new Error(
      `cosineSimilarityWorker not found next to ${fileURLToPath(new URL(import.meta.url))}. Tried: ${workerCandidates.join(", ")}`
    );
  }
  return workerUrl;
}
function execArgvForWorker() {
  const runningTsSource = new URL(import.meta.url).pathname.endsWith(".ts");
  return runningTsSource ? ["--import", "tsx/esm"] : [];
}
function packToBuffer(rows, dims, dtype) {
  if (dtype === "float64") {
    const flat2 = new Float64Array(rows.length * dims);
    rows.forEach((row, i) => flat2.set(row, i * dims));
    return flat2.buffer;
  }
  const flat = new Float32Array(rows.length * dims);
  rows.forEach((row, i) => {
    for (let j = 0; j < dims; j++) flat[i * dims + j] = row[j] ?? 0;
  });
  return flat.buffer;
}
function makeNormsBuffer(allBuffer, rowCount, dims, dtype) {
  const bytes = dtype === "float64" ? 8 : 4;
  const norms = new SharedArrayBuffer(rowCount * bytes);
  if (dtype === "float64") {
    const b2 = new Float64Array(allBuffer);
    const out2 = new Float64Array(norms);
    for (let i = 0; i < rowCount; i++) {
      let sum = 0;
      const base = i * dims;
      for (let k = 0; k < dims; k++) {
        const v = b2[base + k] ?? 0;
        sum += v * v;
      }
      out2[i] = Math.sqrt(sum);
    }
    return norms;
  }
  const b = new Float32Array(allBuffer);
  const out = new Float32Array(norms);
  for (let i = 0; i < rowCount; i++) {
    let sum = 0;
    const base = i * dims;
    for (let k = 0; k < dims; k++) {
      const v = b[base + k] ?? 0;
      sum += v * v;
    }
    out[i] = Math.sqrt(sum);
  }
  return norms;
}
async function parallelCosineSimilarityFlat(A, B, dtype = "float32") {
  if (A.length === 0 || B.length === 0) {
    const empty = dtype === "float64" ? new Float64Array(0) : new Float32Array(0);
    return { data: empty, rows: A.length, cols: B.length };
  }
  const dims = A[0].length;
  const chunkSize = Math.ceil(A.length / os.cpus().length);
  const bytes = dtype === "float64" ? 8 : 4;
  const sharedB = new SharedArrayBuffer(B.length * dims * bytes);
  if (dtype === "float64") {
    const bView = new Float64Array(sharedB);
    B.forEach((row, i) => bView.set(row, i * dims));
  } else {
    const bView = new Float32Array(sharedB);
    B.forEach((row, i) => {
      for (let j = 0; j < dims; j++) bView[i * dims + j] = row[j] ?? 0;
    });
  }
  const normsB = makeNormsBuffer(sharedB, B.length, dims, dtype);
  const sharedResult = new SharedArrayBuffer(A.length * B.length * bytes);
  if (A.length < MIN_PARALLEL_ROWS) {
    const m = cosineSimilarity(A, B);
    const out = dtype === "float64" ? new Float64Array(A.length * B.length) : new Float32Array(A.length * B.length);
    for (let i = 0; i < A.length; i++) {
      for (let j = 0; j < B.length; j++) out[i * B.length + j] = m[i]?.[j] ?? 0;
    }
    return { data: out, rows: A.length, cols: B.length };
  }
  const workerUrl = resolveWorkerUrl();
  const execArgv = execArgvForWorker();
  let rowOffset = 0;
  const chunks = Array.from({ length: Math.ceil(A.length / chunkSize) }, (_, i) => {
    const chunk = A.slice(i * chunkSize, (i + 1) * chunkSize);
    const startRow = rowOffset;
    rowOffset += chunk.length;
    return { chunk, startRow };
  });
  await Promise.all(
    chunks.map(
      ({ chunk, startRow }) => runWorkerFlat(chunk, sharedB, normsB, B.length, dims, sharedResult, startRow, dtype, workerUrl, execArgv)
    )
  );
  const data = dtype === "float64" ? new Float64Array(sharedResult) : new Float32Array(sharedResult);
  return { data, rows: A.length, cols: B.length };
}
async function parallelCosineSimilarity(A, B) {
  if (A.length === 0 || B.length === 0) return [];
  if (A.length < MIN_PARALLEL_ROWS) return cosineSimilarity(A, B);
  const cells = A.length * B.length;
  if (cells > 5e6) {
    throw new Error(
      `parallelCosineSimilarity would allocate a huge number[][] (${A.length}\xD7${B.length}). Use parallelCosineSimilarityFlat(...) instead.`
    );
  }
  const dims = A[0].length;
  const chunkSize = Math.ceil(A.length / os.cpus().length);
  const sharedB = new SharedArrayBuffer(B.length * dims * 8);
  const bView = new Float64Array(sharedB);
  B.forEach((row, i) => bView.set(row, i * dims));
  const sharedResult = new SharedArrayBuffer(A.length * B.length * 8);
  const runningTsSource = new URL(import.meta.url).pathname.endsWith(".ts");
  const workerCandidates = runningTsSource ? ["./cosineSimilarityWorker.ts", "./services/cosineSimilarityWorker.ts"] : ["./cosineSimilarityWorker.js", "./services/cosineSimilarityWorker.js"];
  const workerUrl = workerCandidates.map((candidate) => new URL(candidate, import.meta.url)).find((url) => existsSync(fileURLToPath(url)));
  if (!workerUrl) {
    throw new Error(
      `cosineSimilarityWorker not found next to ${fileURLToPath(new URL(import.meta.url))}. Tried: ${workerCandidates.join(", ")}`
    );
  }
  const execArgv = runningTsSource ? ["--import", "tsx/esm"] : [];
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
    chunks.map(
      ({ chunk, startRow }) => runWorker(chunk, sharedB, B.length, dims, sharedResult, startRow, workerUrl, execArgv)
    )
  );
  const resultView = new Float64Array(sharedResult);
  const result = [];
  for (let i = 0; i < A.length; i++) {
    const row = [];
    for (let j = 0; j < B.length; j++) {
      row.push(resultView[i * B.length + j]);
    }
    result.push(row);
  }
  return result;
}
function runWorker(chunk, sharedB, bCount, dims, sharedResult, startRow, workerUrl, execArgv) {
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
        startRow
      },
      transferList: [rowsFlat.buffer],
      execArgv
    });
    worker.once("message", () => resolve());
    worker.once("error", reject);
  });
}
function runWorkerFlat(chunk, sharedB, normsB, bCount, dims, sharedResult, startRow, dtype, workerUrl, execArgv) {
  return new Promise((resolve, reject) => {
    const rowsBuffer = packToBuffer(chunk, dims, dtype);
    const worker = new Worker(workerUrl, {
      workerData: {
        mode: "flat",
        dtype,
        rowsBuffer,
        rowCount: chunk.length,
        allBuffer: sharedB,
        allCount: bCount,
        normsBuffer: normsB,
        dims,
        resultBuffer: sharedResult,
        startRow
      },
      transferList: [rowsBuffer],
      execArgv
    });
    worker.once("message", () => resolve());
    worker.once("error", reject);
  });
}
var similarityApi = {
  parallelCosineSimilarity,
  parallelCosineSimilarityFlat
};

export {
  __decorateClass,
  parallelCosineSimilarityFlat,
  parallelCosineSimilarity,
  similarityApi
};
//# sourceMappingURL=chunk-SK4GNQXH.js.map