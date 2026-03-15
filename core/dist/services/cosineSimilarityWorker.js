// src/services/cosineSimilarityWorker.ts
import { parentPort, workerData } from "worker_threads";
import { cosineSimilarity } from "@langchain/core/utils/math";
var { rowsBuffer, rowCount, allBuffer, allCount, dims, resultBuffer, startRow } = workerData;
var toMatrix = (buf, count) => Array.from(
  { length: count },
  (_, i) => Array.from(new Float64Array(buf, i * dims * 8, dims))
);
var chunkA = toMatrix(rowsBuffer, rowCount);
var matrixB = toMatrix(allBuffer, allCount);
var result = cosineSimilarity(chunkA, matrixB);
var resultView = new Float64Array(resultBuffer);
for (let i = 0; i < result.length; i++) {
  for (let j = 0; j < result[i].length; j++) {
    resultView[(startRow + i) * allCount + j] = result[i][j];
  }
}
parentPort.postMessage({ done: true });
//# sourceMappingURL=cosineSimilarityWorker.js.map