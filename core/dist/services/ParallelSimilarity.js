import "../chunk-EUXUH3YW.js";

// src/services/ParallelSimilarity.ts
import os from "os";
import { Worker } from "worker_threads";
import debug from "debug";
import { cosineSimilarity } from "@langchain/core/utils/math";
var log = debug("DryScan:ParallelSimilarity");
var GPU_TARGET_CELLS = 2e6;
var ZERO_NORM_EPSILON = 1e-12;
var gpuKernel = null;
var gpuRuntime = null;
var gpuKernelDims = null;
var gpuCtor = null;
var gpuCapabilitiesLogged = false;
var normalizedMatrixCache = /* @__PURE__ */ new WeakMap();
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
function logGpuCapabilities(GPU) {
  if (gpuCapabilitiesLogged) return;
  const flags = GPU;
  log(
    "SIM_GPU capabilities supported=%s headlessgl=%s webgl=%s webgl2=%s singlePrecision=%s",
    String(flags.isGPUSupported),
    String(flags.isHeadlessGLSupported),
    String(flags.isWebGLSupported),
    String(flags.isWebGL2Supported),
    String(flags.isSinglePrecisionSupported)
  );
  gpuCapabilitiesLogged = true;
}
function backendPreference() {
  const value = (process.env.DRYSCAN_SIM_BACKEND ?? "auto").toLowerCase();
  if (value === "gpu") return "gpu";
  if (value === "worker") return "worker";
  if (value === "sync") return "sync";
  return "auto";
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
function normalizeRows(rows, dims) {
  return rows.map((row) => {
    const normalized = new Float32Array(dims);
    let normSq = 0;
    for (let i = 0; i < dims; i++) {
      const value = Number(row[i] ?? 0);
      normalized[i] = value;
      normSq += value * value;
    }
    const norm = Math.sqrt(normSq);
    if (norm > ZERO_NORM_EPSILON) {
      for (let i = 0; i < dims; i++) {
        normalized[i] /= norm;
      }
    } else {
      normalized.fill(0);
    }
    return normalized;
  });
}
function getNormalizedRows(rows, dims) {
  const cached = normalizedMatrixCache.get(rows);
  if (cached && cached.dims === dims) {
    return cached.rows;
  }
  const normalized = normalizeRows(rows, dims);
  normalizedMatrixCache.set(rows, { dims, rows: normalized });
  return normalized;
}
async function runGpuCosineSimilarity(A, B) {
  const GPU = await getGpuCtor();
  if (!GPU) {
    throw new Error("gpu.js module not available");
  }
  logGpuCapabilities(GPU);
  if (GPU.isGPUSupported === false) {
    throw new Error("GPU.js reported GPU support unavailable");
  }
  const dims = A[0]?.length ?? 0;
  if (!dims || !B[0]?.length || B[0].length !== dims) {
    throw new Error("Matrix dimensions are invalid for GPU similarity");
  }
  const normalizeStartMs = performance.now();
  const normalizedA = getNormalizedRows(A, dims);
  const normalizedB = getNormalizedRows(B, dims);
  const normalizeMs = Math.round(performance.now() - normalizeStartMs);
  if (!gpuRuntime) {
    gpuRuntime = new GPU({ mode: "gpu" });
    const runtimeMode = String(gpuRuntime.mode ?? "unknown");
    log("SIM_GPU runtime mode=%s", runtimeMode);
    if (runtimeMode === "cpu") {
      throw new Error("GPU runtime initialized in CPU mode");
    }
  }
  const shouldRecreateKernel = !gpuKernel || gpuKernelDims !== dims;
  if (shouldRecreateKernel) {
    const kernel = gpuRuntime.createKernel(function(a, b) {
      let dot = 0;
      for (let i = 0; i < this.constants.dims; i++) {
        const av = a[this.thread.y][i];
        const bv = b[this.thread.x][i];
        dot += av * bv;
      }
      return dot;
    }).setOutput([1, 1]).setConstants({ dims });
    if (typeof kernel.setPrecision === "function") {
      kernel.setPrecision("single");
    }
    if (typeof kernel.setTactic === "function") {
      kernel.setTactic("speed");
    }
    if (typeof kernel.setDynamicArguments === "function") {
      kernel.setDynamicArguments(true);
    }
    if (typeof kernel.setDynamicOutput === "function") {
      kernel.setDynamicOutput(true);
    }
    gpuKernel = kernel;
    gpuKernelDims = dims;
  }
  if (!gpuKernel) {
    throw new Error("GPU kernel initialization failed");
  }
  let targetCells = GPU_TARGET_CELLS;
  if (!Number.isFinite(targetCells) || targetCells <= 0) {
    targetCells = 2e6;
  }
  let rowsPerBatch = Math.floor(targetCells / normalizedB.length);
  if (rowsPerBatch < 1) {
    rowsPerBatch = 1;
  }
  const result = [];
  const batches = Math.ceil(normalizedA.length / rowsPerBatch);
  const kernelStartMs = performance.now();
  for (let start = 0; start < normalizedA.length; start += rowsPerBatch) {
    const batch = normalizedA.slice(start, start + rowsPerBatch);
    gpuKernel.setOutput([normalizedB.length, batch.length]);
    const raw = gpuKernel(batch, normalizedB);
    result.push(...matrixFromGpuResult(raw, batch.length, normalizedB.length));
  }
  const kernelMs = Math.round(performance.now() - kernelStartMs);
  log(
    "SIM_GPU details dims=%d aRows=%d bRows=%d rowsPerBatch=%d batches=%d targetCells=%d normalizeMs=%d kernelMs=%d",
    dims,
    A.length,
    B.length,
    rowsPerBatch,
    batches,
    targetCells,
    normalizeMs,
    kernelMs
  );
  return result;
}
async function computeWithWorkers(A, B) {
  const dims = A[0].length;
  const cpuCount = Math.max(1, os.cpus().length);
  const chunkSize = Math.max(1, Math.ceil(A.length / cpuCount));
  const sharedB = new SharedArrayBuffer(B.length * dims * 8);
  const bView = new Float64Array(sharedB);
  B.forEach((row, i) => bView.set(row, i * dims));
  const runningTsSource = new URL(import.meta.url).pathname.endsWith(".ts");
  let workerFile = "./cosineSimilarityWorker.js";
  if (runningTsSource) {
    workerFile = "./cosineSimilarityWorker.ts";
  }
  const workerUrl = new URL(workerFile, import.meta.url);
  let execArgv = [];
  if (runningTsSource) {
    execArgv = ["--import", "tsx/esm"];
  }
  const chunks = Array.from(
    { length: Math.ceil(A.length / chunkSize) },
    (_, i) => A.slice(i * chunkSize, (i + 1) * chunkSize)
  );
  const results = await Promise.all(chunks.map((chunk) => runWorker(chunk, sharedB, B.length, dims, workerUrl, execArgv)));
  return results.flat();
}
function computeSequential(A, B) {
  return cosineSimilarity(A, B);
}
async function runWithTiming(name, fn) {
  const startMs = performance.now();
  log("SIM_TRY backend=%s", name);
  try {
    const result = await Promise.resolve(fn());
    const durationMs = Math.round(performance.now() - startMs);
    log("SIM_DONE backend=%s durationMs=%d", name, durationMs);
    return result;
  } catch (err) {
    const durationMs = Math.round(performance.now() - startMs);
    log("SIM_FAIL backend=%s durationMs=%d reason=%s", name, durationMs, err?.message ?? "unknown");
    throw err;
  }
}
async function parallelCosineSimilarity(A, B) {
  if (A.length === 0 || B.length === 0) return [];
  const preference = backendPreference();
  const dims = A[0]?.length ?? 0;
  log("SIM_START rows=%d cols=%d dims=%d preference=%s", A.length, B.length, dims, preference);
  if (preference === "sync") {
    return runWithTiming("sync", () => computeSequential(A, B));
  }
  if (preference === "worker") {
    try {
      return await runWithTiming("worker", () => computeWithWorkers(A, B));
    } catch (_workerErr) {
      return runWithTiming("sync", () => computeSequential(A, B));
    }
  }
  try {
    return await runWithTiming("gpu", () => runGpuCosineSimilarity(A, B));
  } catch (_gpuErr) {
    log("SIM_CHAIN continue_after=gpu-fail next=worker");
  }
  try {
    return await runWithTiming("worker", () => computeWithWorkers(A, B));
  } catch (_workerErr) {
    log("SIM_CHAIN continue_after=worker-fail next=sync");
    return runWithTiming("sync", () => computeSequential(A, B));
  }
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