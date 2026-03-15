import { parentPort, workerData } from "node:worker_threads";

type DType = "float32" | "float64";

const {
  mode,
  dtype,
  rowsBuffer,
  rowCount,
  allBuffer,
  allCount,
  normsBuffer,
  dims,
  resultBuffer,
  startRow,
} = workerData as {
  mode?: "flat";
  dtype?: DType;
  rowsBuffer: ArrayBuffer;
  rowCount: number;
  allBuffer: SharedArrayBuffer;
  allCount: number;
  normsBuffer?: SharedArrayBuffer;
  dims: number;
  resultBuffer: SharedArrayBuffer;
  startRow: number;
};

const resolvedMode = mode ?? "flat";
const resolvedDType: DType = dtype ?? "float64";

function computeFlatFloat64(): void {
  const A = new Float64Array(rowsBuffer);
  const B = new Float64Array(allBuffer);
  const normsB = normsBuffer ? new Float64Array(normsBuffer) : null;
  const out = new Float64Array(resultBuffer);

  for (let i = 0; i < rowCount; i++) {
    let normA2 = 0;
    const aBase = i * dims;
    for (let k = 0; k < dims; k++) {
      const v = A[aBase + k] ?? 0;
      normA2 += v * v;
    }
    const normA = Math.sqrt(normA2);

    for (let j = 0; j < allCount; j++) {
      const normB = normsB ? normsB[j] : 0;
      if (normA === 0 || normB === 0) {
        out[(startRow + i) * allCount + j] = 0;
        continue;
      }
      let dot = 0;
      const bBase = j * dims;
      for (let k = 0; k < dims; k++) {
        dot += (A[aBase + k] ?? 0) * (B[bBase + k] ?? 0);
      }
      out[(startRow + i) * allCount + j] = dot / (normA * normB);
    }
  }
}

function computeFlatFloat32(): void {
  const A = new Float32Array(rowsBuffer);
  const B = new Float32Array(allBuffer);
  const normsB = normsBuffer ? new Float32Array(normsBuffer) : null;
  const out = new Float32Array(resultBuffer);

  for (let i = 0; i < rowCount; i++) {
    let normA2 = 0;
    const aBase = i * dims;
    for (let k = 0; k < dims; k++) {
      const v = A[aBase + k] ?? 0;
      normA2 += v * v;
    }
    const normA = Math.sqrt(normA2);

    for (let j = 0; j < allCount; j++) {
      const normB = normsB ? normsB[j] : 0;
      if (normA === 0 || normB === 0) {
        out[(startRow + i) * allCount + j] = 0;
        continue;
      }
      let dot = 0;
      const bBase = j * dims;
      for (let k = 0; k < dims; k++) {
        dot += (A[aBase + k] ?? 0) * (B[bBase + k] ?? 0);
      }
      out[(startRow + i) * allCount + j] = dot / (normA * normB);
    }
  }
}

if (resolvedMode === "flat") {
  if (resolvedDType === "float32") computeFlatFloat32();
  else computeFlatFloat64();
} else {
  // Only "flat" is supported now. Any other mode falls back to flat.
  if (resolvedDType === "float32") computeFlatFloat32();
  else computeFlatFloat64();
}

parentPort!.postMessage({ done: true });
