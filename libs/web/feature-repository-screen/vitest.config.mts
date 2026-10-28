import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/web/feature-repository-screen',
  plugins: [ angular() ],
  // Vite 8 resolves the aliases of tsconfig.base.json natively.
  resolve: { tsconfigPaths: true },
  test: {
    name: 'web-feature-repository-screen',
    watch: false,
    globals: true,
    environment: 'jsdom',
    setupFiles: [ 'src/test-setup.ts' ],
    include: [ 'src/**/*.spec.ts' ],
    reporters: [ 'default' ]
  }
});
