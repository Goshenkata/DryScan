import os from "node:os";
import { Worker } from "node:worker_threads";
import debug from "debug";
import { cosineSimilarity } from "@langchain/core/utils/math";

const log = debug("DryScan:ParallelSimilarity");

/**
 * Target number of output cells per GPU launch.
 * Large enough to keep GPU occupancy healthy, bounded enough to avoid oversized output buffers.
 */
const GPU_TARGET_CELLS = 2_000_000;
const ZERO_NORM_EPSILON = 1e-12;

type BackendPreference = "auto" | "gpu" | "worker" | "sync";
type GPUCtor = new (settings?: { mode?: string }) => {
  createKernel: (fn: (...args: any[]) => number) => GpuKernel;
};
type GPUModule = {
  GPU: GPUCtor & { isGPUSupported?: boolean };
};

type GpuInputMatrix = ArrayLike<ArrayLike<number>>;
type GpuKernel = {
  (a: GpuInputMatrix, b: GpuInputMatrix): number[][] | Float32Array[] | number[];
  setOutput: (output: [number, number]) => GpuKernel;
  setConstants: (constants: { dims: number }) => GpuKernel;
  setDynamicOutput?: (enabled: boolean) => GpuKernel;
};

let gpuKernel:
  | GpuKernel
  | null = null;
let gpuRuntime: InstanceType<GPUCtor> | null = null;
let gpuKernelDims: number | null = null;
let gpuCtor: (GPUCtor & { isGPUSupported?: boolean }) | null = null;
let gpuCapabilitiesLogged = false;

const normalizedMatrixCache = new WeakMap<number[][], { dims: number; rows: Float32Array[] }>();

type BackendName = "gpu" | "worker" | "sync";

async function getGpuCtor(): Promise<(GPUCtor & { isGPUSupported?: boolean }) | null> {
  if (gpuCtor) return gpuCtor;

  const moduleName = "gpu.js";
  try {
    const mod = (await import(moduleName)) as unknown as GPUModule;
    gpuCtor = mod.GPU;
    return gpuCtor;
  } catch (_err) {
    return null;
  }
}

function logGpuCapabilities(GPU: GPUCtor & { isGPUSupported?: boolean }): void {
  if (gpuCapabilitiesLogged) return;

  const flags = GPU as unknown as {
    isGPUSupported?: boolean;
    isHeadlessGLSupported?: boolean;
    isWebGLSupported?: boolean;
    isWebGL2Supported?: boolean;
    isSinglePrecisionSupported?: boolean;
  };

  log(
    "SIM_GPU capabilities supported=%s headlessgl=%s webgl=%s webgl2=%s singlePrecision=%s",
    String(flags.isGPUSupported),
    String(flags.isHeadlessGLSupported),
    String(flags.isWebGLSupported),
    String(flags.isWebGL2Supported),
    String(flags.isSinglePrecisionSupported),
  );

  gpuCapabilitiesLogged = true;
}

function backendPreference(): BackendPreference {
  const value = (process.env.DRYSCAN_SIM_BACKEND ?? "auto").toLowerCase();
  if (value === "gpu") return "gpu";
  if (value === "worker") return "worker";
  if (value === "sync") return "sync";
  return "auto";
}

function matrixFromGpuResult(result: unknown, rows: number, cols: number): number[][] {
  if (!Array.isArray(result)) {
    throw new Error("GPU kernel returned a non-array result");
  }

  return Array.from({ length: rows }, (_, rowIdx) => {
    const row = result[rowIdx] as unknown;
    if (!row || typeof row !== "object") {
      throw new Error("GPU kernel returned malformed rows");
    }
    const typed = row as ArrayLike<number>;
    return Array.from({ length: cols }, (_, colIdx) => Number(typed[colIdx] ?? 0));
  });
}

function normalizeRows(rows: number[][], dims: number): Float32Array[] {
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

function getNormalizedRows(rows: number[][], dims: number): Float32Array[] {
  const cached = normalizedMatrixCache.get(rows);
  if (cached && cached.dims === dims) {
    return cached.rows;
  }

  const normalized = normalizeRows(rows, dims);
  normalizedMatrixCache.set(rows, { dims, rows: normalized });
  return normalized;
}

async function runGpuCosineSimilarity(A: number[][], B: number[][]): Promise<number[][]> {
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
    const runtimeMode = String((gpuRuntime as unknown as { mode?: string }).mode ?? "unknown");
    log("SIM_GPU runtime mode=%s", runtimeMode);
    if (runtimeMode === "cpu") {
      throw new Error("GPU runtime initialized in CPU mode");
    }
  }

  const shouldRecreateKernel =
    !gpuKernel
    || gpuKernelDims !== dims;

  if (shouldRecreateKernel) {
    const kernel = gpuRuntime
      .createKernel(function (this: any, a: number[][], b: number[][]) {
        let dot = 0;
        for (let i = 0; i < this.constants.dims; i++) {
          const av = a[this.thread.y][i];
          const bv = b[this.thread.x][i];
          dot += av * bv;
        }
        return dot;
      })
      .setOutput([1, 1])
      .setConstants({ dims });

    if (typeof (kernel as any).setPrecision === "function") {
      (kernel as any).setPrecision("single");
    }
    if (typeof (kernel as any).setTactic === "function") {
      (kernel as any).setTactic("speed");
    }
    if (typeof (kernel as any).setDynamicArguments === "function") {
      (kernel as any).setDynamicArguments(true);
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
    targetCells = 2_000_000;
  }

  let rowsPerBatch = Math.floor(targetCells / normalizedB.length);
  if (rowsPerBatch < 1) {
    rowsPerBatch = 1;
  }

  const result: number[][] = [];
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
    kernelMs,
  );

  return result;
}

async function computeWithWorkers(A: number[][], B: number[][]): Promise<number[][]> {
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
  let execArgv: string[] = [];
  if (runningTsSource) {
    execArgv = ["--import", "tsx/esm"];
  }

  const chunks = Array.from(
    { length: Math.ceil(A.length / chunkSize) },
    (_, i) => A.slice(i * chunkSize, (i + 1) * chunkSize),
  );

  const results = await Promise.all(chunks.map(chunk => runWorker(chunk, sharedB, B.length, dims, workerUrl, execArgv)));
  return results.flat();
}

function computeSequential(A: number[][], B: number[][]): number[][] {
  return cosineSimilarity(A, B);
}

async function runWithTiming(name: BackendName, fn: () => Promise<number[][]> | number[][]): Promise<number[][]> {
  const startMs = performance.now();
  log("SIM_TRY backend=%s", name);

  try {
    const result = await Promise.resolve(fn());
    const durationMs = Math.round(performance.now() - startMs);
    log("SIM_DONE backend=%s durationMs=%d", name, durationMs);
    return result;
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - startMs);
    log("SIM_FAIL backend=%s durationMs=%d reason=%s", name, durationMs, err?.message ?? "unknown");
    throw err;
  }
}

/**
 * Computes cosine similarity using a deterministic backend chain.
 * Default chain: GPU -> worker threads -> synchronous fallback.
 */
export async function parallelCosineSimilarity(A: number[][], B: number[][]): Promise<number[][]> {
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
