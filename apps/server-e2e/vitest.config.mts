import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/server-e2e',
  test: {
    name: 'server-e2e',
    watch: false,
    globals: true,
    environment: 'node',
    include: [ 'src/**/*.e2e.spec.ts' ],
    reporters: [ 'default' ],
    testTimeout: 30000,
    hookTimeout: 30000
  }
});
