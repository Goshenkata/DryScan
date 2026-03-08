import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/services/cosineSimilarityWorker.ts', 'src/services/ParallelSimilarity.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  external: [
    '@langchain/ollama',
    '@langchain/community',
    '@langchain/core',
  ],
});
