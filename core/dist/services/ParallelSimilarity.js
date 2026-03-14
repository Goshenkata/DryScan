import "../chunk-EUXUH3YW.js";

// src/services/ParallelSimilarity.ts
import os from "os";
import { Worker } from "worker_threads";
import debug from "debug";
import { cosineSimilarity } from "@langchain/core/utils/math";
var MIN_PARALLEL_ROWS = 50;
var log = debug("DryScan:ParallelSimilarity");
var gpuKernel = null;
var gpuRuntime = null;
var gpuKernelDims = null;
var gpuKernelRows = null;
var gpuKernelCols = null;
var gpuCtor = null;
async function getGpuCtor() {
  if (gpuCtor) return gpuCtor;
  const moduleName = "gpu.js";
  try {
    const mod = await import(moduleName);
    gpuCtor = mod.GPU;
    return gpuCtor;
  } catch (_err) {
    return null;
  }
}
function backendPreference() {
  const value = (process.env.DRYSCAN_SIM_BACKEND ?? "auto").toLowerCase();
  if (value === "gpu" || value === "worker") return value;
  return "auto";
}
function canUseGpuPath() {
  return backendPreference() !== "worker";
}
function matrixFromGpuResult(result, rows, cols) {
  if (!Array.isArray(result)) {
    throw new Error("GPU kernel returned a non-array result");
  }
  return Array.from({ length: rows }, (_, rowIdx) => {
    const row = result[rowIdx];
    if (!row || typeof row !== "object") {
      throw new Error("GPU kernel returned malformed rows");
    }
    const typed = row;
    return Array.from({ length: cols }, (_2, colIdx) => Number(typed[colIdx] ?? 0));
  });
}
async function runGpuCosineSimilarity(A, B) {
  const GPU = await getGpuCtor();
  if (!GPU) {
    throw new Error("gpu.js module not available");
  }
  if (GPU.isGPUSupported === false) {
    throw new Error("GPU.js reported GPU support unavailable");
  }
  const dims = A[0]?.length ?? 0;
  if (!dims || !B[0]?.length || B[0].length !== dims) {
    throw new Error("Matrix dimensions are invalid for GPU similarity");
  }
  if (!gpuRuntime) {
    gpuRuntime = new GPU({ mode: "gpu" });
  }
  const shouldRecreateKernel = !gpuKernel || gpuKernelDims !== dims || gpuKernelRows !== A.length || gpuKernelCols !== B.length;
  if (shouldRecreateKernel) {
    gpuKernel = gpuRuntime.createKernel(function(a, b) {
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < this.constants.dims; i++) {
        const av = a[this.thread.y][i];
        const bv = b[this.thread.x][i];
        dot += av * bv;
        normA += av * av;
        normB += bv * bv;
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      if (denom <= 1e-12) return 0;
      return dot / denom;
    }).setOutput([B.length, A.length]).setConstants({ dims });
    gpuKernelDims = dims;
    gpuKernelRows = A.length;
    gpuKernelCols = B.length;
  }
  if (!gpuKernel) {
    throw new Error("GPU kernel initialization failed");
  }
  const raw = gpuKernel(A, B);
  return matrixFromGpuResult(raw, A.length, B.length);
}
function computeWithWorkers(A, B) {
  const dims = A[0].length;
  const chunkSize = Math.ceil(A.length / os.cpus().length);
  const sharedB = new SharedArrayBuffer(B.length * dims * 8);
  const bView = new Float64Array(sharedB);
  B.forEach((row, i) => bView.set(row, i * dims));
  const workerUrl = new URL("./cosineSimilarityWorker.js", import.meta.url);
  const execArgv = workerUrl.pathname.endsWith(".ts") ? ["--import", "tsx/esm"] : [];
  const chunks = Array.from(
    { length: Math.ceil(A.length / chunkSize) },
    (_, i) => A.slice(i * chunkSize, (i + 1) * chunkSize)
  );
  return Promise.all(chunks.map((chunk) => runWorker(chunk, sharedB, B.length, dims, workerUrl, execArgv))).then((results) => results.flat());
}
async function parallelCosineSimilarity(A, B) {
  if (A.length === 0 || B.length === 0) return [];
  if (A.length < MIN_PARALLEL_ROWS) {
    log("SIM_BACKEND=sync rows=%d cols=%d", A.length, B.length);
    return cosineSimilarity(A, B);
  }
  const preference = backendPreference();
  if (canUseGpuPath()) {
    try {
      const result = await runGpuCosineSimilarity(A, B);
      log("SIM_BACKEND=gpu rows=%d cols=%d preference=%s", A.length, B.length, preference);
      return result;
    } catch (err) {
      log("SIM_BACKEND=gpu-failed fallback=worker reason=%s", err?.message ?? "unknown");
    }
  }
  log("SIM_BACKEND=worker rows=%d cols=%d preference=%s", A.length, B.length, preference);
  return computeWithWorkers(A, B);
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
export {
  parallelCosineSimilarity
};
//# sourceMappingURL=ParallelSimilarity.js.map