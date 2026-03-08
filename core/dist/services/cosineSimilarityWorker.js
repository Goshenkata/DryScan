// src/services/cosineSimilarityWorker.ts
import { parentPort, workerData } from "worker_threads";
import { cosineSimilarity } from "@langchain/core/utils/math";
var { rowsBuffer, rowCount, allBuffer, allCount, dims } = workerData;
var toMatrix = (buf, count) => Array.from(
  { length: count },
  (_, i) => Array.from(new Float64Array(buf, i * dims * 8, dims))
);
parentPort.postMessage({
  result: cosineSimilarity(toMatrix(rowsBuffer, rowCount), toMatrix(allBuffer, allCount))
});
//# sourceMappingURL=cosineSimilarityWorker.js.map