import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/shared/util',
  // Vite 8 resolves the aliases of tsconfig.base.json natively.
  resolve: { tsconfigPaths: true },
  test: {
    name: 'shared-util',
    watch: false,
    globals: true,
    environment: 'node',
    include: [ 'src/**/*.spec.ts' ],
    reporters: [ 'default' ],
    coverage: {
      reportsDirectory: '../../../coverage/libs/shared/util',
      provider: 'v8'
    }
  }
});
