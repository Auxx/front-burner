import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findConfigProblems, importsShared } from './vitest-configs.mjs';
import { WORKSPACE_ROOT } from './workspace.mjs';

const at = path => join(WORKSPACE_ROOT, path);
const SHARED =
  'import { nodeConfig } from \'../../vitest.shared.mjs\';\n\nexport default nodeConfig(import.meta.dirname);\n';
const OWN = 'import { defineConfig } from \'vitest/config\';\n\nexport default defineConfig({ test: {} });\n';
const BASE = 'import { sharedTestOptions } from \'./vitest.shared.mjs\';\n';

/** `findConfigProblems` over in-memory files, keyed by workspace path. */
function problemsOf(projects, files) {
  const byPath = new Map(Object.entries(files).map(([ path, source ]) => [ at(path), source ]));
  return findConfigProblems(projects, {
    read: path => {
      if (!byPath.has(path)) {
        throw new Error(`not in the fixture: ${path}`);
      }
      return byPath.get(path);
    },
    exists: path => byPath.has(path)
  }).map(p => `${p.project}: ${p.problem}`);
}

const vitestProject = (name, root, options = {}) => ({
  name,
  root,
  targets: { test: { executor: 'nx:run-commands', options: { command: 'vitest run', cwd: root, ...options } } }
});
const angularProject = (name, root, options = {}, executor = '@angular/build:unit-test') => ({
  name,
  root,
  targets: { test: { executor, options: { watch: false, ...options } } }
});

describe('vitest-configs', () => {
  describe('importsShared', () => {
    it('accepts the shared module by any extension TypeScript and Vite resolve to it', () => {
      for (const specifier of [ 'vitest.shared.mjs', 'vitest.shared.mts', 'vitest.shared.js', 'vitest.shared.ts' ]) {
        expect(
          importsShared(`import { nodeConfig } from '../../${specifier}';`, at('libs/a/vitest.config.mts')),
          specifier
        )
          .toBe(true);
      }
      expect(importsShared('import { x } from "./vitest.shared.mjs";', at('vitest-base.config.mts'))).toBe(true);
    });

    it('refuses another file, a path that misses the root and a package', () => {
      const file = at('libs/a/vitest.config.mts');
      expect(importsShared('import { defineConfig } from \'vitest/config\';', file)).toBe(false);
      expect(importsShared('import { x } from \'../vitest.shared.mjs\';', file)).toBe(false);
      expect(importsShared('import { x } from \'../../vitest.shared-copy.mjs\';', file)).toBe(false);
      expect(importsShared('import { x } from \'vitest.shared\';', file)).toBe(false);
    });
  });

  describe('findConfigProblems', () => {
    it('accepts Vitest projects and Angular builder projects that use the shared settings', () => {
      expect(problemsOf(
        [
          vitestProject('a', 'libs/a'),
          angularProject('web', 'apps/web', { runnerConfig: true }),
          angularProject('ui', 'libs/ui', { runnerConfig: true }, '@nx/angular:unit-test'),
          { name: 'no-tests', root: 'libs/b', targets: { lint: {} } }
        ],
        { 'libs/a/vitest.config.mts': SHARED, 'vitest-base.config.mts': BASE }
      )).toEqual([]);
    });

    it('reports a config that does not import the shared module, as a generator writes it', () => {
      expect(problemsOf([ vitestProject('a', 'libs/a') ], { 'libs/a/vitest.config.mts': OWN })).toEqual([
        expect.stringMatching(
          /^a: libs\/a\/vitest.config.mts \(Vitest config\) does not import vitest.shared.mts: .*nodeConfig/
        )
      ]);
    });

    it('reports a Vitest project without a config, and one that picks its own', () => {
      expect(problemsOf(
        [ vitestProject('a', 'libs/a'), vitestProject('b', 'libs/b', { command: 'vitest run --config other.mts' }) ],
        {}
      )).toEqual([
        expect.stringMatching(/^a: libs\/a has no vitest.config.mts/),
        expect.stringMatching(/^b: .*--config/)
      ]);
    });

    it('reads the config of the folder the command runs in', () => {
      expect(problemsOf([ vitestProject('a', 'libs/a', { cwd: 'libs/a/tests' }) ], {
        'libs/a/vitest.config.mts': SHARED,
        'libs/a/tests/vitest.config.mts': OWN
      })).toEqual([ expect.stringMatching(/^a: libs\/a\/tests\/vitest.config.mts/) ]);
    });

    it('reports an Angular builder project without runnerConfig', () => {
      expect(problemsOf([ angularProject('web', 'apps/web') ], { 'vitest-base.config.mts': BASE })).toEqual([
        expect.stringMatching(/^web: test \(@angular\/build:unit-test\) has no runnerConfig/)
      ]);
    });

    it('prefers the project\'s own vitest-base.config.mts, as the builder does', () => {
      expect(problemsOf([ angularProject('web', 'apps/web', { runnerConfig: true }) ], {
        'apps/web/vitest-base.config.mts': OWN,
        'vitest-base.config.mts': BASE
      })).toEqual([ expect.stringMatching(/^web: apps\/web\/vitest-base.config.mts \(runnerConfig\)/) ]);
    });

    it('checks a runnerConfig given as a path, and reports one with nothing to find', () => {
      expect(problemsOf([ angularProject('web', 'apps/web', { runnerConfig: 'apps/web/tests.mts' }) ], {
        'apps/web/tests.mts': OWN
      })).toEqual([ expect.stringMatching(/^web: apps\/web\/tests.mts \(runnerConfig\)/) ]);
      expect(problemsOf([ angularProject('web', 'apps/web', { runnerConfig: true }) ], {})).toEqual([
        expect.stringMatching(/no vitest-base.config.mts in the project or the workspace root/)
      ]);
    });

    it('reports a test target it does not know, rather than passing it', () => {
      expect(problemsOf([
        { name: 'j', root: 'libs/j', targets: { test: { executor: '@nx/jest:jest' } } },
        vitestProject('k', 'libs/k', { command: 'node run-tests.js' })
      ], {})).toEqual([
        'j: test uses @nx/jest:jest; teach vitest-configs about it',
        'k: test runs `node run-tests.js`, not `vitest run`; teach vitest-configs about it'
      ]);
    });

    it('refuses project roots and config paths outside the workspace', () => {
      expect(() => problemsOf([ vitestProject('a', '../outside') ], {})).toThrow(/outside the workspace/);
      expect(() => problemsOf([ angularProject('web', 'apps/web', { runnerConfig: '../x.mts' }) ], {}))
        .toThrow(/outside the workspace/);
    });
  });

  it('finds the shared module in the workspace\'s own vitest-base.config.mts', () => {
    const file = at('vitest-base.config.mts');
    expect(importsShared(readFileSync(file, 'utf8'), file)).toBe(true);
  });
});
