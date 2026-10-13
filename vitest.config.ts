import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: false } },
  },
  resolve: {
    // Tests import server sources directly; TS source exports resolve via tsx-style loaders.
    extensions: ['.ts', '.js'],
  },
  esbuild: { target: 'es2022' },
});
