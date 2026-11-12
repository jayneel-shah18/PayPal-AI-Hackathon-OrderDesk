import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // tsconfig keeps JSX as-is for Next.js; tests need it compiled.
  oxc: { jsx: { runtime: 'automatic' } },
  test: { environment: 'node', exclude: process.env.LIVE ? ['node_modules'] : ['node_modules', 'tests/live/**'], testTimeout: 120_000, fileParallelism: false },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
});
