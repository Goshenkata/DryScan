import os from "node:os";
import { Worker } from "node:worker_threads";
import debug from "debug";
import { cosineSimilarity } from "@langchain/core/utils/math";

/** Minimum row count below which synchronous is faster than worker overhead. */
const MIN_PARALLEL_ROWS = 50;
const log = debug("DryScan:ParallelSimilarity");

type BackendPreference = "auto" | "gpu" | "worker";
type GPUCtor = new (settings?: { mode?: string }) => {
  createKernel: (fn: (...args: any[]) => number) => {
    setOutput: (output: [number, number]) => {
      setConstants: (constants: { dims: number }) => (a: number[][], b: number[][]) => number[][] | Float32Array[] | number[];
    };
  };
};
type GPUModule = {
  GPU: GPUCtor & { isGPUSupported?: boolean };
};

let gpuKernel:
  | ((a: number[][], b: number[][]) => number[][] | Float32Array[] | number[])
  | null = null;
let gpuRuntime: InstanceType<GPUCtor> | null = null;
let gpuKernelDims: number | null = null;
let gpuKernelRows: number | null = null;
let gpuKernelCols: number | null = null;
let gpuCtor: (GPUCtor & { isGPUSupported?: boolean }) | null = null;

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

function backendPreference(): BackendPreference {
  const value = (process.env.DRYSCAN_SIM_BACKEND ?? "auto").toLowerCase();
  if (value === "gpu" || value === "worker") return value;
  return "auto";
}

function canUseGpuPath(): boolean {
  return backendPreference() !== "worker";
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

async function runGpuCosineSimilarity(A: number[][], B: number[][]): Promise<number[][]> {
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

  const shouldRecreateKernel =
    !gpuKernel
    || gpuKernelDims !== dims
    || gpuKernelRows !== A.length
    || gpuKernelCols !== B.length;

  if (shouldRecreateKernel) {
    gpuKernel = gpuRuntime
      .createKernel(function (this: any, a: number[][], b: number[][]) {
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
      })
      .setOutput([B.length, A.length])
      .setConstants({ dims });

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

function computeWithWorkers(A: number[][], B: number[][]): Promise<number[][]> {
  const dims = A[0].length;
  const chunkSize = Math.ceil(A.length / os.cpus().length);

  const sharedB = new SharedArrayBuffer(B.length * dims * 8);
  const bView = new Float64Array(sharedB);
  B.forEach((row, i) => bView.set(row, i * dims));

  // import.meta.resolve respects the active module loader:
  // under tsx it remaps .js → .ts; in compiled output it stays .js.
  const workerUrl = new URL("./cosineSimilarityWorker.js", import.meta.url);
  const execArgv = workerUrl.pathname.endsWith(".ts") ? ["--import", "tsx/esm"] : [];

  const chunks = Array.from(
    { length: Math.ceil(A.length / chunkSize) },
    (_, i) => A.slice(i * chunkSize, (i + 1) * chunkSize),
  );

  return Promise.all(chunks.map(chunk => runWorker(chunk, sharedB, B.length, dims, workerUrl, execArgv))).then(results => results.flat());
}

/**
 * Computes cosineSimilarity(A, B) using worker threads for large inputs,
 * falling back to the synchronous library call for small ones.
 * B is packed into a SharedArrayBuffer shared across all workers — no copies.
 */
export async function parallelCosineSimilarity(A: number[][], B: number[][]): Promise<number[][]> {
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
    } catch (err: any) {
      log("SIM_BACKEND=gpu-failed fallback=worker reason=%s", err?.message ?? "unknown");
    }
  }

  log("SIM_BACKEND=worker rows=%d cols=%d preference=%s", A.length, B.length, preference);
  return computeWithWorkers(A, B);
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
