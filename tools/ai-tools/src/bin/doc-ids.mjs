#!/usr/bin/env node
import { main, print, table, UsageError } from '../lib/cli.mjs';
import {
  applyMapping,
  checkIds,
  DEFAULT_ROOTS,
  findIds,
  parseId,
  renameMapping,
  scan,
  shiftMapping
} from '../lib/doc-ids.mjs';

const SCAN_OPTIONS = {
  path: { type: 'string', multiple: true },
  'include-plans': { type: 'boolean' },
  json: { type: 'boolean' }
};

const SCAN_HELP = `Options:
  --path <path>      a file or folder to scan, inside the workspace (repeatable;
                     default ${DEFAULT_ROOTS.join(', ')})
  --include-plans    also scan docs/superpowers, whose plans normally keep the
                     numbers they were written with`;

const readFiles = options => scan({ roots: options.path ?? DEFAULT_ROOTS, includePlans: options['include-plans'] });
const allIds = files => [ ...new Set(files.flatMap(({ text }) => findIds(text).map(found => found.id))) ];

function report(options, mapping, files) {
  if (!mapping.size) {
    console.log('Nothing to renumber.');
    return 0;
  }
  const { changed, changes } = applyMapping(files, mapping, { write: options.write });
  print(options.json, { mapping: Object.fromEntries(mapping), written: Boolean(options.write), changes }, () =>
    [
      table([ [ 'from', 'to' ], ...[ ...mapping ].map(([ from, to ]) => [ from, to ]) ]),
      '',
      ...changes.map(c => `${c.path}:${c.line}  ${c.from} → ${c.to}`),
      '',
      `${changes.length} references in ${changed.length} files ${
        options.write ? 'changed' : 'would change; rerun with --write'
      }.`
    ].join('\n'));
  return 0;
}

main({
  name: 'doc-ids',
  summary: 'Checks and renumbers requirement and architecture IDs (REQ, A, D, NF, LG, …) in docs and code.',
  commands: {
    check: {
      usage: '[--path <path>] [--include-plans] [--json]',
      summary: 'Reports duplicate definitions, references to undefined IDs and missing numbers; exits with 1 on any.',
      help: SCAN_HELP,
      options: SCAN_OPTIONS,
      run(options) {
        const result = checkIds(readFiles(options));
        const issues = result.duplicates.length + result.dangling.length + result.gaps.length;
        print(options.json, result, () =>
          [
            `${result.definitions} IDs defined, ${result.references} references.`,
            ...result.duplicates.map(d => `Duplicate ${d.id}: ${d.places.map(p => `${p.path}:${p.line}`).join(', ')}`),
            ...result.dangling.map(d => `Undefined ${d.id}: ${d.path}:${d.line}`),
            ...result.gaps.map(g => `Missing in ${g.family}: ${g.missing.join(', ')}`),
            issues ? `${issues} issues.` : 'No issues.'
          ].join('\n'));
        return issues ? 1 : 0;
      }
    },
    find: {
      usage: '<id> [--path <path>] [--include-plans] [--json]',
      summary: 'Lists where an ID, and its sub-IDs, is defined and referenced.',
      help: SCAN_HELP,
      options: SCAN_OPTIONS,
      run(options, [ id, ...rest ]) {
        if (!id || rest.length || !parseId(id)) {
          throw new UsageError('Give one ID, such as A-10.38');
        }
        const places = readFiles(options).flatMap(({ path, text }) =>
          findIds(text)
            .filter(found => found.id === id || found.id.startsWith(`${id}.`))
            .map(found => ({ id: found.id, path, line: found.line, definition: found.definition }))
        );
        print(options.json, places, () =>
          places.length
            ? places.map(p => `${p.path}:${p.line}  ${p.id}${p.definition ? `  (defined: ${p.definition})` : ''}`).join(
              '\n'
            )
            : `${id} is not used.`);
      }
    },
    renumber: {
      usage: '<family> --from <n> --by <k> [--write] [--path …] [--include-plans] [--json]',
      summary: 'Shifts every ID of a family numbered n or more by k, in definitions and references.',
      help: `The family is the ID without its last number: A-10 for A-10.x, LG for LG-x,
REQ-EDIT for REQ-EDIT-00x. Sub-IDs move with their parent, and zero padding is
kept. To make room for a new A-10.21: renumber A-10 --from 21 --by 1.
Prints the changes only; --write applies them. Refuses when a new ID is
already used.

${SCAN_HELP}`,
      options: { ...SCAN_OPTIONS, from: { type: 'string' }, by: { type: 'string' }, write: { type: 'boolean' } },
      run(options, [ family, ...rest ]) {
        const from = Number(options.from);
        const by = Number(options.by);
        if (!family || rest.length || !Number.isInteger(from) || !Number.isInteger(by) || by === 0) {
          throw new UsageError('Give one family, --from and a non-zero --by (whole numbers)');
        }
        const files = readFiles(options);
        return report(options, shiftMapping(allIds(files), family, from, by), files);
      }
    },
    rename: {
      usage: '<id> <new-id> [--write] [--path …] [--include-plans] [--json]',
      summary: 'Renames one ID and its sub-IDs everywhere, such as moving A-10.42 to a free number.',
      help: `Prints the changes only; --write applies them. Refuses when the new ID is
already used.

${SCAN_HELP}`,
      options: { ...SCAN_OPTIONS, write: { type: 'boolean' } },
      run(options, [ from, to, ...rest ]) {
        if (!from || !to || rest.length) {
          throw new UsageError('Give the ID and its new ID');
        }
        const files = readFiles(options);
        return report(options, renameMapping(allIds(files), from, to), files);
      }
    }
  }
});
