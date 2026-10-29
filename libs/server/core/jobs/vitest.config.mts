import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../../../node_modules/.vite/libs/server/core/jobs',
  // Nest's dependency injection needs emitDecoratorMetadata, which the default
  // transform does not emit.
  // SWC does not know tsconfig's es2025 target yet; Node runs the latest syntax as it is.
  plugins: [ swc.vite({ jsc: { target: 'esnext' } }) ],
  // Vite 8 resolves the aliases of tsconfig.base.json natively.
  resolve: { tsconfigPaths: true },
  test: {
    name: 'server-core-jobs',
    watch: false,
    globals: true,
    environment: 'node',
    include: [ 'src/**/*.spec.ts' ],
    reporters: [ 'default' ],
    coverage: {
      reportsDirectory: '../../../../coverage/libs/server/core/jobs',
      provider: 'v8'
    }
  }
});
