import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { resolveInWorkspace, WORKSPACE_ROOT, workspacePath } from './workspace.mjs';

/** The module every project's unit tests build on, without its extension. */
export const SHARED_MODULE = join(WORKSPACE_ROOT, 'vitest.shared');

/** The executors of the Angular unit-test builder, which read a Vitest config through `runnerConfig`. */
export const ANGULAR_EXECUTORS = [ '@angular/build:unit-test', '@nx/angular:unit-test' ];

/** The names Vitest looks for in a project, in its order. */
const VITEST_CONFIGS = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs'
];

/** The names the Angular builder looks for with `runnerConfig: true`, in its order (`findVitestBaseConfig`). */
const BASE_CONFIGS = [
  'vitest-base.config.ts',
  'vitest-base.config.mts',
  'vitest-base.config.cts',
  'vitest-base.config.js',
  'vitest-base.config.mjs',
  'vitest-base.config.cjs'
];

const FIX = 'build on vitest.shared.mts, e.g. `export default nodeConfig(import.meta.dirname);` '
  + '(nestConfig for NestJS, angularConfig for Angular)';

/**
 * Whether the source of the config file `file` imports the shared module. Only
 * relative specifiers count; `.mjs`, `.mts`, `.js` and `.ts` all name
 * `vitest.shared.mts`, as TypeScript and Vite resolve them.
 */
export function importsShared(source, file) {
  const specifiers = [ ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g) ].map(match => match[1]);
  return specifiers.some(specifier => {
    if (!specifier.startsWith('.')) {
      return false;
    }
    const { dir, name, ext } = parse(join(dirname(file), specifier));
    const base = [ '.mjs', '.mts', '.js', '.ts' ].includes(ext) ? join(dir, name) : join(dir, name + ext);
    return base === SHARED_MODULE;
  });
}

function firstExisting(dir, names, exists) {
  return names.map(name => join(dir, name)).find(path => exists(path));
}

/** The command line of a `nx:run-commands` target, or `undefined` when it has several. */
function commandOf(options = {}) {
  if (typeof options.command === 'string') {
    return options.command;
  }
  return options.commands?.length === 1 ? String(options.commands[0].command ?? options.commands[0]) : undefined;
}

/**
 * The problems with the `test` target of each project: `{ project, problem }`.
 * `projects` are `{ name, root, targets }` with the target defaults applied,
 * as in the Nx project graph; `read` and `exists` take absolute paths.
 */
export function findConfigProblems(projects, { read = path => readFileSync(path, 'utf8'), exists = existsSync } = {}) {
  const problems = [];
  for (const { name, root, targets } of projects) {
    const test = targets?.test;
    if (!test) {
      continue;
    }
    const report = problem => problems.push({ project: name, problem });
    const dir = resolveInWorkspace(root);
    const checkFile = (file, what) => {
      if (!importsShared(read(file), file)) {
        report(`${workspacePath(file)} (${what}) does not import vitest.shared.mts: ${FIX}`);
      }
    };

    if (test.executor === 'nx:run-commands') {
      const command = commandOf(test.options);
      if (!command || !/^(npx )?vitest( run)?\b/.test(command)) {
        report(`test runs \`${command ?? 'several commands'}\`, not \`vitest run\`; teach vitest-configs about it`);
      } else if (/\s(--config|-c)(\s|=)/.test(command)) {
        report('test picks its own Vitest config with --config; use the project\'s vitest.config.mts');
      } else {
        const cwd = resolveInWorkspace(test.options.cwd ?? root);
        const config = firstExisting(cwd, VITEST_CONFIGS, exists);
        if (config) {
          checkFile(config, 'Vitest config');
        } else {
          report(`${workspacePath(cwd)} has no vitest.config.mts: ${FIX}`);
        }
      }
    } else if (ANGULAR_EXECUTORS.includes(test.executor)) {
      const runnerConfig = test.options?.runnerConfig;
      if (runnerConfig === true) {
        const config = firstExisting(dir, BASE_CONFIGS, exists) ?? firstExisting(WORKSPACE_ROOT, BASE_CONFIGS, exists);
        if (config) {
          checkFile(config, 'runnerConfig');
        } else {
          report('runnerConfig is true, but there is no vitest-base.config.mts in the project or the workspace root');
        }
      } else if (typeof runnerConfig === 'string') {
        checkFile(resolveInWorkspace(runnerConfig), 'runnerConfig');
      } else {
        report(`test (${test.executor}) has no runnerConfig, so it reads no shared settings; nx.json sets it to true`);
      }
    } else {
      report(`test uses ${test.executor ?? 'no executor'}; teach vitest-configs about it`);
    }
  }
  return problems;
}
