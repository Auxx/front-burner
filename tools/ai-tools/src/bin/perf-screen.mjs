#!/usr/bin/env node
import { join } from 'node:path';
import { main, print, table, UsageError } from '../lib/cli.mjs';
import { hostSummary, PASSWORD_VARIABLE, Session, startGitServer, TEST_CERTIFICATE } from '../lib/perf-api.mjs';
import {
  createScreenRemote,
  DEFAULT_WORK,
  MEASURES,
  PROFILES,
  SCREEN_OPERATIONS,
  ScreenBrowser,
  selectMeasures,
  SLOW_4G
} from '../lib/perf-screen.mjs';
import { allPass, resultRows, resultTable } from '../lib/perf-stats.mjs';
import { resolveInWorkspace, workspacePath } from '../lib/workspace.mjs';

const log = message => process.stderr.write(`${message}\n`);

function wholeNumber(value, option, min) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min) {
    throw new UsageError(`${option} must be a whole number of at least ${min}: ${value}`);
  }
  return n;
}

function hostLine(host) {
  return `Host: ${host.cpus} CPUs (${host.cpuModel}), ${host.memoryGb} GB memory, ${host.platform}`;
}

main({
  name: 'perf-screen',
  summary: 'Measures the screen targets of NF-2 in a throttled Chromium and prints p95 next to each target.',
  commands: {
    run: {
      usage:
        '--url <instance> --email <email> [--profile desktop|phone] [--runs 20] [--warmup 1] [--measures …] [--name screen] [--json]',
      summary:
        'Adds its repository, times NF-2.1, NF-2.2, NF-2.5 and NF-2.7 in fresh browser contexts, prints a table.',
      help: [
        `The password is read from ${PASSWORD_VARIABLE}. The instance must serve the web client, and its git`,
        `must trust ${workspacePath(TEST_CERTIFICATE)} (GIT_SSL_CAINFO): the tool serves the remote`,
        'itself, over HTTPS on this host, as perf-api.mjs does.',
        '',
        'Each run is a fresh browser context, so the cache is cold; the times end at the web client\'s own',
        'performance marks (A-8.17). "Slow 4G" is Chrome DevTools\' preset: '
        + `${SLOW_4G.latency} ms, ${SLOW_4G.downloadThroughput / 1000} KB/s down, `
        + `${SLOW_4G.uploadThroughput / 1000} KB/s up.`,
        '',
        '--url        the instance, such as http://127.0.0.1:3000',
        '--email      the user to log in as; logged in once for the whole run',
        '--profile    desktop (Desktop Chrome) or phone (Pixel 7, CPU 4× slower); default desktop',
        '--runs       measured runs per measure (default 20)',
        '--warmup     unmeasured runs first (default 1)',
        `--measures   a comma-separated list of ${MEASURES.join(', ')} (default all)`,
        '--name       the repository to create; refused when it exists (default screen)',
        `--work       folder for the remote (default ${DEFAULT_WORK})`,
        '--git-host   address the git server listens on (default 127.0.0.1)',
        '--git-port   its port (default: any free one)'
      ].join('\n'),
      options: {
        url: { type: 'string' },
        email: { type: 'string' },
        profile: { type: 'string', default: 'desktop' },
        runs: { type: 'string', default: '20' },
        warmup: { type: 'string', default: '1' },
        measures: { type: 'string' },
        name: { type: 'string', default: 'screen' },
        work: { type: 'string', default: DEFAULT_WORK },
        'git-host': { type: 'string', default: '127.0.0.1' },
        'git-port': { type: 'string', default: '0' },
        json: { type: 'boolean' }
      },
      async run(options) {
        if (!options.url || !options.email) {
          throw new UsageError('Name the instance with --url and the user with --email.');
        }
        if (!Object.hasOwn(PROFILES, options.profile)) {
          throw new UsageError(`--profile must be desktop or phone: ${options.profile}`);
        }
        if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(options.name)) {
          throw new UsageError(`--name must be lower-case letters, digits and dashes: ${options.name}`);
        }
        const password = process.env[PASSWORD_VARIABLE];
        if (!password) {
          throw new UsageError(`Set ${PASSWORD_VARIABLE} to the password.`);
        }
        const runs = wholeNumber(options.runs, '--runs', 1);
        const warmup = wholeNumber(options.warmup, '--warmup', 0);
        let measures;
        try {
          measures = selectMeasures(options.measures, options.profile);
        } catch (error) {
          throw new UsageError(error.message);
        }
        const work = resolveInWorkspace(options.work);
        const host = hostSummary();
        log(hostLine(host));

        const session = new Session(options.url, options.email, password);
        await session.login();
        if ((await session.repositoryNames()).has(options.name)) {
          throw new Error(`${options.email} has a repository named ${options.name} already: pick another --name.`);
        }
        const gitServer = await startGitServer(join(work, 'remotes'), {
          host: options['git-host'],
          port: wholeNumber(options['git-port'], '--git-port', 0)
        });
        const browser = new ScreenBrowser({ url: options.url, profile: options.profile });
        try {
          createScreenRemote(work, options.name);
          log(`Adding ${options.name}`);
          const id = await session.addRepository(options.name, `${gitServer.url}/${options.name}.git`);
          await browser.start(options.email, password);

          const steps = {
            'first-load': () => browser.firstLoad(),
            folder: () => browser.folder(id),
            'editor-broadband': () => browser.editor(id, 'editor-broadband'),
            'editor-slow-4g': () => browser.editor(id, 'editor-slow-4g'),
            preview: run => browser.preview(id, run)
          };
          const samples = {};
          const record = (key, value) => (samples[key] ??= []).push(value);
          for (const measure of measures) {
            for (let run = -warmup; run < runs; run++) {
              const result = await steps[measure](run + warmup);
              if (run < 0) {
                continue;
              }
              if (typeof result === 'number') {
                record(measure, result);
              } else {
                for (const [ key, value ] of Object.entries(result)) {
                  record(key, value);
                }
              }
            }
            log(`${measure}: ${runs} runs`);
          }

          const rows = resultRows(samples, {}, SCREEN_OPERATIONS);
          const result = { host, url: options.url, profile: options.profile, runs, warmup, rows };
          print(options.json, result, () =>
            [
              '',
              hostLine(host),
              `Instance: ${options.url}; profile ${options.profile} (${PROFILES[options.profile].device}, CPU ${
                PROFILES[options.profile].cpuRate
              }× slower); ${runs} runs after ${warmup} warm-up runs, each in a fresh context`,
              '',
              table(resultTable(rows)),
              '',
              'Slow 4G is Chrome DevTools\' preset; broadband and the preview are not throttled. The first load',
              'ends at fb:app-ready; the warm row reloads the same context, for information.'
            ].join('\n'));
          return allPass(rows) ? 0 : 1;
        } finally {
          await browser.close();
          session.close();
          await gitServer.close();
        }
      }
    }
  }
});
