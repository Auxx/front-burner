#!/usr/bin/env node
import { main, print, table, UsageError } from '../lib/cli.mjs';
import {
  DEFAULT_FILES,
  DEFAULT_OUT,
  DEFAULT_SEED,
  DEFAULT_SIZE,
  headOf,
  parseSizeOption,
  planRepo,
  shapeOf,
  writeRepo
} from '../lib/large-repo.mjs';
import { resolveInWorkspace, workspacePath } from '../lib/workspace.mjs';

const mb = bytes => `${(bytes / 1000 ** 2).toFixed(1)} MB`;
const kb = bytes => `${(bytes / 1000).toFixed(1)} KB`;

function shapeText(shape, head, path) {
  return [
    `Repository: ${path}`,
    `Commit:     ${head ?? '(none)'}`,
    '',
    table([
      [ 'Files', 'Folders', 'Depth', 'Total', 'Median', 'Mean', 'Largest' ],
      [
        shape.files.toLocaleString('en'),
        shape.folders.toLocaleString('en'),
        String(shape.maxDepth),
        mb(shape.totalBytes),
        kb(shape.medianBytes),
        kb(shape.meanBytes),
        kb(shape.maxBytes)
      ]
    ]),
    '',
    `Extensions: ${shape.extensions.map(e => `.${e.extension} ${e.count.toLocaleString('en')}`).join(', ')}`
  ].join('\n');
}

main({
  name: 'gen-large-repo',
  summary: 'Writes a git repository of 100,000 files for perf-api.mjs --large (NF-2.8, spike 4), and prints its shape.',
  commands: {
    generate: {
      usage: '[--out dir] [--seed 1] [--files 100000] [--size 1.2GB] [--from path] [--json]',
      summary:
        'Writes the repository, one commit, and prints its shape; with --from, only prints the shape of a clone.',
      help: [
        'The tree is about 5 levels deep with one folder per 22 files; file sizes are log-normal with a',
        'median of 4 KB, scaled to the total; mostly .c, .h and .md text, 1% binary. The same seed and',
        'options always give the same commit ID.',
        '',
        `--out    folder in the workspace, missing or empty (default ${DEFAULT_OUT})`,
        `--seed   a whole number (default ${DEFAULT_SEED})`,
        `--files  how many files (default ${DEFAULT_FILES})`,
        '--size   total size of the files: bytes, or a number with KB, MB or GB, 1000-based (default 1.2GB)',
        '--from   a clone in the workspace, such as Linux under tmp/, to print its shape instead (to compare',
        '         with spike 4); nothing is written',
        '--json   print the shape as JSON'
      ].join('\n'),
      options: {
        out: { type: 'string', default: DEFAULT_OUT },
        seed: { type: 'string', default: String(DEFAULT_SEED) },
        files: { type: 'string', default: String(DEFAULT_FILES) },
        size: { type: 'string', default: String(DEFAULT_SIZE) },
        from: { type: 'string' },
        json: { type: 'boolean' }
      },
      run(options) {
        if (options.from !== undefined) {
          const from = resolveInWorkspace(options.from);
          const shape = shapeOf(from);
          const head = headOf(from);
          print(
            options.json,
            { path: workspacePath(from), head, shape },
            () => shapeText(shape, head, workspacePath(from))
          );
          return 0;
        }
        const seed = Number(options.seed);
        const files = Number(options.files);
        const size = parseSizeOption(options.size);
        if (!Number.isSafeInteger(seed) || seed < 0) {
          throw new UsageError(`--seed must be a whole number: ${options.seed}`);
        }
        if (!Number.isSafeInteger(files) || files < 1) {
          throw new UsageError(`--files must be a whole number of at least 1: ${options.files}`);
        }
        if (size === undefined || size < files) {
          throw new UsageError(`--size must be a size of at least one byte per file: ${options.size}`);
        }
        const out = resolveInWorkspace(options.out);
        const plan = planRepo({ seed, files, size });
        const started = Date.now();
        const head = writeRepo(out, plan, {
          seed,
          onProgress: written => process.stderr.write(`  ${written.toLocaleString('en')} files written\n`)
        });
        const shape = shapeOf(out);
        print(
          options.json,
          { path: workspacePath(out), head, seed, seconds: Math.round((Date.now() - started) / 1000), shape },
          () => shapeText(shape, head, workspacePath(out))
        );
        return 0;
      }
    }
  }
});
