import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@contracts': path.resolve(import.meta.dirname, 'contracts'),
      '@framework-core': path.resolve(import.meta.dirname, 'packages/framework-core'),
    },
  },
});
