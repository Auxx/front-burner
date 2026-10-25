import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/tools/ai-tools',
  test: {
    name: 'ai-tools',
    watch: false,
    environment: 'node',
    include: [ 'src/**/*.spec.mjs' ],
    reporters: [ 'default' ],
    coverage: {
      reportsDirectory: '../../coverage/tools/ai-tools',
      provider: 'v8'
    }
  }
});
