#!/usr/bin/env node
import { main, print, table, UsageError } from '../lib/cli.mjs';
import { DEFAULT_OUT, formatBytes, formatSeconds, runProfile, SCENARIOS } from '../lib/mem-profile.mjs';

main({
  name: 'mem-profile',
  summary: 'Runs a test scenario and reports the memory of every process it starts.',
  commands: {
    list: {
      usage: '[--json]',
      summary: 'Lists the scenarios and the commands they run.',
      options: { json: { type: 'boolean' } },
      run(options) {
        const scenarios = Object.entries(SCENARIOS).map(([ name, s ]) => ({ name, ...s }));
        print(options.json, scenarios, () =>
          table([
            [ 'Scenario', 'Runs' ],
            ...scenarios.map(s => [ s.name, s.summary ])
          ]));
      }
    },
    run: {
      usage: '<scenario> [--interval 1000] [--label name] [--out dir] [--quiet] [--json] [-- extra args]',
      summary:
        'Runs the scenario, samples its process tree and writes <out>/<scenario>/<time>[-label].md, .json and .log.',
      help: [
        'Arguments after -- are appended to the scenario\'s command, to compare settings:',
        '  mem-profile.mjs run unit --label parallel-1 -- --parallel=1',
        '',
        `--interval  milliseconds between samples (250 or more; default 1000)`,
        `--label     added to the report's file name, to tell runs apart`,
        `--out       folder in the workspace for the reports (default ${DEFAULT_OUT})`,
        `--quiet     write the command's output only to the log, not to the terminal`,
        `--json      print the run's summary as JSON (the command's output goes to stderr)`
      ].join('\n'),
      options: {
        interval: { type: 'string', default: '1000' },
        label: { type: 'string' },
        out: { type: 'string', default: DEFAULT_OUT },
        quiet: { type: 'boolean' },
        json: { type: 'boolean' }
      },
      async run(options, [ scenario, ...extraArgs ]) {
        if (!scenario) {
          throw new UsageError('Name a scenario; `list` shows them.');
        }
        const intervalMs = Number(options.interval);
        if (!Number.isInteger(intervalMs) || intervalMs < 250) {
          throw new UsageError(`--interval must be a whole number of milliseconds, 250 or more: ${options.interval}`);
        }
        const run = await runProfile({
          scenario,
          extraArgs,
          label: options.label,
          intervalMs,
          out: options.out,
          echo: options.quiet ? null : options.json ? process.stderr : process.stdout
        });
        const { summary } = run;
        print(options.json, { ...run, summary: { ...summary, samples: undefined } }, () =>
          [
            '',
            `${run.scenario}: exit code ${run.exitCode}${run.interrupted ? ' (interrupted)' : ''} after ${
              formatSeconds(run.durationSeconds)
            }`,
            summary.peak
              ? `Peak ${summary.metric}: ${formatBytes(summary.peak.bytes)} in ${summary.peak.count} processes at ${
                formatSeconds(summary.peak.t)
              }; system in use at most ${formatBytes(summary.systemPeak.used)}`
              : 'No samples were taken.',
            ...summary.categories.slice(0, 5).map(c => `  ${c.name}: up to ${formatBytes(c.bytes)} in ${c.count}`),
            `Report: ${run.files.report}`
          ].join('\n'));
        return run.exitCode === 0 ? 0 : 1;
      }
    }
  }
});
