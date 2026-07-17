import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Keep Node builtins (node:sqlite) external during SSR transform so vitest does
  // not try to bundle/resolve them.
  ssr: {
    external: ['node:sqlite'],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.{test,spec}.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    server: {
      deps: {
        external: ['node:sqlite'],
      },
    },
  },
});
