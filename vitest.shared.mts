import angular from '@analogjs/vite-plugin-angular';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig, mergeConfig, type ViteUserConfig } from 'vitest/config';

/**
 * The unit-test settings every project shares. The `vitest.config.mts` of each
 * project builds on one of the configs below, and `vitest-base.config.mts`
 * gives these to the projects that the Angular unit-test builder runs. The
 * `vitest-configs` tool of ai-tools checks that every project does.
 */
export const sharedTestOptions = {
  globals: true,
  // Nx runs 3 projects at once: 30% of the cores each was the fastest setting
  // that stays reliable, using less memory than the default (ai-tools mem-profile).
  maxWorkers: '30%'
} satisfies ViteUserConfig['test'];

export interface ProjectOptions {
  /** The test files, relative to the project; `src/**\/*.spec.ts` by default. */
  include?: string[];
}

/** The config of the project in `dir` (its `import.meta.dirname`) for Node unit tests. */
export function nodeConfig(dir: string, { include = [ 'src/**/*.spec.ts' ] }: ProjectOptions = {}): ViteUserConfig {
  const path = relative(import.meta.dirname, dir);
  const { name } = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as { name: string; };
  return defineConfig({
    root: dir,
    cacheDir: join(import.meta.dirname, 'node_modules', '.vite', path),
    // Vite 8 resolves the aliases of tsconfig.base.json natively.
    resolve: { tsconfigPaths: true },
    test: {
      ...sharedTestOptions,
      name,
      watch: false,
      environment: 'node',
      include,
      reporters: [ 'default' ],
      coverage: {
        reportsDirectory: join(import.meta.dirname, 'coverage', path),
        provider: 'v8'
      }
    }
  });
}

/** `nodeConfig` for NestJS code. */
export function nestConfig(dir: string, options?: ProjectOptions): ViteUserConfig {
  return mergeConfig(
    nodeConfig(dir, options),
    defineConfig({
      // Nest's dependency injection needs emitDecoratorMetadata, which the default
      // transform does not emit.
      // SWC does not know tsconfig's es2025 target yet; Node runs the latest syntax as it is.
      plugins: [ swc.vite({ jsc: { target: 'esnext' } }) ]
    })
  );
}

/** `nodeConfig` for Angular code, in jsdom, with the project's `src/test-setup.ts`. */
export function angularConfig(dir: string, options?: ProjectOptions): ViteUserConfig {
  return mergeConfig(
    nodeConfig(dir, options),
    defineConfig({
      plugins: [ angular() ],
      test: {
        environment: 'jsdom',
        setupFiles: [ 'src/test-setup.ts' ]
      }
    })
  );
}
