#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { main, print, table, UsageError } from '../lib/cli.mjs';
import { summariseProfile, timeline } from '../lib/cpu-profile.mjs';
import { resolveInWorkspace, workspacePath } from '../lib/workspace.mjs';

function seconds(value, option) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new UsageError(`${option} must be a number of seconds, 0 or more: ${value}`);
  }
  return n;
}

function load(file) {
  if (!file) {
    throw new UsageError('Name the .cpuprofile file.');
  }
  const path = resolveInWorkspace(file);
  return { path, profile: JSON.parse(readFileSync(path, 'utf8')) };
}

const ms = value => `${value.toFixed(0)} ms`;
const share = (value, of) => `${of === 0 ? 0 : ((value / of) * 100).toFixed(1)}%`;

main({
  name: 'cpu-profile',
  summary: 'Summarises a V8 CPU profile (node --cpu-prof): busy time over time, top functions and packages.',
  commands: {
    timeline: {
      usage: '<file.cpuprofile> [--bucket 5] [--json]',
      summary: 'Busy (not idle) time in each bucket of seconds, to find the part of a profile to summarise.',
      options: { bucket: { type: 'string', default: '5' }, json: { type: 'boolean' } },
      run(options, [ file ]) {
        const { path, profile } = load(file);
        const bucketMs = seconds(options.bucket, '--bucket') * 1000;
        if (bucketMs === 0) {
          throw new UsageError('--bucket must be more than 0.');
        }
        const rows = timeline(profile, bucketMs);
        print(options.json, rows, () =>
          [
            workspacePath(path),
            table([
              [ 'From', 'Busy', 'Of the bucket' ],
              ...rows.map(row => [ `${(row.fromMs / 1000).toFixed(0)} s`, ms(row.busyMs), share(row.busyMs, bucketMs) ])
            ])
          ].join('\n'));
      }
    },
    summary: {
      usage: '<file.cpuprofile> [--from <s>] [--to <s>] [--top 25] [--json]',
      summary: 'Top functions by self and total time, and self time by package, over the profile or a window.',
      help: [
        'Times are of the main thread only: a CPU profile does not see libuv\'s threads or child processes.',
        'Total time counts a function once per stack, so recursion is not counted twice. Packages are read',
        'from node_modules/ in the script URL; "node" is Node.js\'s own JavaScript, "application" any other',
        'script (a bundled main.js is one), "(native)" frames with no script.',
        '',
        '--from, --to  the window, in seconds from the profile\'s start (see `timeline`)',
        '--top         rows in each list (default 25)'
      ].join('\n'),
      options: {
        from: { type: 'string', default: '0' },
        to: { type: 'string' },
        top: { type: 'string', default: '25' },
        json: { type: 'boolean' }
      },
      run(options, [ file ]) {
        const { path, profile } = load(file);
        const fromMs = seconds(options.from, '--from') * 1000;
        const toMs = options.to === undefined ? Infinity : seconds(options.to, '--to') * 1000;
        const top = Number(options.top);
        if (!Number.isSafeInteger(top) || top < 1) {
          throw new UsageError(`--top must be a whole number of at least 1: ${options.top}`);
        }
        const summary = summariseProfile(profile, { fromMs, toMs, top });
        print(options.json, summary, () =>
          [
            `${workspacePath(path)}: ${ms(summary.lengthMs)} in all; the window ${ms(summary.windowMs)}, busy ${
              ms(summary.busyMs)
            }`,
            '',
            'Self time by package (share of busy time):',
            table([
              [ 'Package', 'Self', 'Share' ],
              ...summary.packages.filter(row => row.name !== '(idle)').map(row => [
                row.name,
                ms(row.ms),
                share(row.ms, summary.busyMs)
              ])
            ]),
            '',
            'Functions by self time:',
            table([
              [ 'Function', 'Self', 'Share' ],
              ...summary.self.filter(row => row.name !== '(idle)').map(row => [
                row.name,
                ms(row.ms),
                share(row.ms, summary.busyMs)
              ])
            ]),
            '',
            'Functions by total time (with what they call):',
            table([
              [ 'Function', 'Total', 'Share' ],
              ...summary.total.map(row => [ row.name, ms(row.ms), share(row.ms, summary.busyMs) ])
            ])
          ].join('\n'));
      }
    }
  }
});
