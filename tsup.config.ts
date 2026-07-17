import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
    'api/index': 'src/api/index.ts',
  },
  format: ['esm'],
  target: 'node18',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  // The CLI bin shebang is set directly in src/cli/index.ts so esbuild preserves it.
  // We intentionally do NOT add a global banner (it would wrongly annotate the library entry).
  external: [
    '@sqlite.org/sqlite-wasm',
    'web-tree-sitter',
    'tree-sitter-wasm',
    'chokidar',
    'fastify',
    'ora',
    'commander',
    'zod',
    'ignore',
    'fast-glob',
    'p-limit',
  ],
});
