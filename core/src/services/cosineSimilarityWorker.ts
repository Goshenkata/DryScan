import { parentPort, workerData } from "node:worker_threads";
import { cosineSimilarity } from "@langchain/core/utils/math";

const { rowsBuffer, rowCount, allBuffer, allCount, dims } = workerData as {
  rowsBuffer: ArrayBuffer;
  rowCount: number;
  /** SharedArrayBuffer so all workers can read B without copying it again. */
  allBuffer: SharedArrayBuffer;
  allCount: number;
  dims: number;
};

const toMatrix = (buf: ArrayBuffer | SharedArrayBuffer, count: number): number[][] =>
  Array.from({ length: count }, (_, i) =>
    Array.from(new Float64Array(buf, i * dims * 8, dims))
  );

parentPort!.postMessage({
  result: cosineSimilarity(toMatrix(rowsBuffer, rowCount), toMatrix(allBuffer, allCount)),
});
