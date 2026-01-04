import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
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
