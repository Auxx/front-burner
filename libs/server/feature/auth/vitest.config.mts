import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../../../node_modules/.vite/libs/server/feature/auth',
  // Nest's dependency injection needs emitDecoratorMetadata, which the default
  // transform does not emit.
  plugins: [ swc.vite() ],
  // Vite 8 resolves the aliases of tsconfig.base.json natively.
  resolve: { tsconfigPaths: true },
  test: {
    name: 'server-feature-auth',
    watch: false,
    globals: true,
    environment: 'node',
    include: [ 'src/**/*.spec.ts' ],
    reporters: [ 'default' ],
    coverage: {
      reportsDirectory: '../../../../coverage/libs/server/feature/auth',
      provider: 'v8'
    }
  }
});
