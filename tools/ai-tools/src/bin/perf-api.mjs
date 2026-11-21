#!/usr/bin/env node
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { main, print, table, UsageError } from '../lib/cli.mjs';
import { DEFAULT_OUT as DEFAULT_LARGE_REPO, shapeOf } from '../lib/large-repo.mjs';
import {
  createLargeRemote,
  createRemote,
  DEFAULT_WORK,
  fillDataDir,
  hostSummary,
  measureBasics,
  measureLarge,
  PASSWORD_VARIABLE,
  scaleUserEmail,
  Session,
  startGitServer,
  TEST_CERTIFICATE,
  waitUntilReady
} from '../lib/perf-api.mjs';
import { resultRows, resultTable } from '../lib/perf-stats.mjs';
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
  return `Host: ${host.cpus} CPUs (${host.cpuModel}), ${host.memoryGb} GB memory, ${host.platform}, ${host.git}`;
}

main({
  name: 'perf-api',
  summary: 'Measures the API targets of NF-2 against a running instance and prints p95 next to each target.',
  commands: {
    run: {
      usage:
        '--url <instance> (--email <email> | --users <n>) [--name perf] [--runs 50] [--warmup 5] [--large] [--cold] [--json]',
      summary:
        'Prepares its repositories, times NF-2.1 to NF-2.3 and NF-2.6 (and NF-2.8 with --large), prints a table.',
      help: [
        `The password is read from ${PASSWORD_VARIABLE}. The instance must run with`,
        `FRONT_BURNER_SERVER_TIMING=true, and its git must trust ${workspacePath(TEST_CERTIFICATE)}`,
        '(GIT_SSL_CAINFO): the tool serves the remotes itself, over HTTPS on this host.',
        '',
        'Durations are the server\'s own, from Server-Timing, so the client\'s network is left out. NF-2.6\'s',
        'rows time a pull or push job from its request to job.finished and subtract the median of plain',
        '`git pull` or `git push` against the same remote from this host.',
        '',
        '--url        the instance, such as http://127.0.0.1:3000',
        '--email      the user to log in as',
        '--users      log in as the first n users that `scale` seeded, at once, each with a repository of',
        '             its own (NF-1.2); they share the password',
        '--name       the repository to create; refused when it exists (default perf)',
        '--runs       measured runs per operation (default 50)',
        '--warmup     unmeasured runs first (default 5)',
        `--large      also add the repository of gen-large-repo.mjs (--large-repo, default ${DEFAULT_LARGE_REPO})`,
        '             as <name>-large and time status and commit (NF-2.8); for the first user only',
        '--cold       also time status and commit after dropping the page cache (--cold-runs, default 5);',
        '             Linux, as root, on the instance\'s host',
        `--work       folder for the remotes and clones (default ${DEFAULT_WORK})`,
        '--git-host   address the git server listens on and the instance clones from (default 127.0.0.1;',
        '             the test certificate is for localhost, 127.0.0.1 and ::1)',
        '--git-port   its port (default: any free one)'
      ].join('\n'),
      options: {
        url: { type: 'string' },
        email: { type: 'string' },
        users: { type: 'string' },
        name: { type: 'string', default: 'perf' },
        runs: { type: 'string', default: '50' },
        warmup: { type: 'string', default: '5' },
        large: { type: 'boolean' },
        'large-repo': { type: 'string', default: DEFAULT_LARGE_REPO },
        cold: { type: 'boolean' },
        'cold-runs': { type: 'string', default: '5' },
        work: { type: 'string', default: DEFAULT_WORK },
        'git-host': { type: 'string', default: '127.0.0.1' },
        'git-port': { type: 'string', default: '0' },
        json: { type: 'boolean' }
      },
      async run(options) {
        if (!options.url) {
          throw new UsageError('Name the instance with --url.');
        }
        if ((options.email === undefined) === (options.users === undefined)) {
          throw new UsageError('Give either --email or --users.');
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
        const coldRuns = wholeNumber(options['cold-runs'], '--cold-runs', 1);
        const users = options.users === undefined ? undefined : wholeNumber(options.users, '--users', 1);
        if (options.cold && !options.large) {
          throw new UsageError('--cold times the large repository: add --large.');
        }
        if (options.cold && (process.platform !== 'linux' || process.getuid?.() !== 0)) {
          throw new UsageError('--cold drops the page cache: run it on Linux, as root.');
        }
        const work = resolveInWorkspace(options.work);
        const largeRepo = options.large ? resolveInWorkspace(options['large-repo']) : undefined;
        const host = hostSummary();
        log(hostLine(host));

        const emails = users === undefined
          ? [ options.email ]
          : Array.from({ length: users }, (_, i) => scaleUserEmail(i + 1));
        const gitServer = await startGitServer(join(work, 'remotes'), {
          host: options['git-host'],
          port: wholeNumber(options['git-port'], '--git-port', 0)
        });
        const sessions = [];
        try {
          const contexts = [];
          for (const [ index, email ] of emails.entries()) {
            const session = new Session(options.url, email, password);
            sessions.push(session);
            await session.login();
            if ((await session.call('GET', '/me')).serverMs === undefined) {
              throw new Error(
                'The instance sent no Server-Timing header: start it with FRONT_BURNER_SERVER_TIMING=true.'
              );
            }
            const name = users === undefined ? options.name : `${options.name}-u${index + 1}`;
            const names = await session.repositoryNames();
            for (const taken of [ name, ...(index === 0 && options.large ? [ `${options.name}-large` ] : []) ]) {
              if (names.has(taken)) {
                throw new Error(`${email} has a repository named ${taken} already: pick another --name.`);
              }
            }
            await session.confirmCommitAuthor();
            const { clones } = createRemote(work, name);
            log(`${email}: adding ${name}`);
            const id = await session.addRepository(name, `${gitServer.url}/${name}.git`);
            await session.startEvents();
            contexts.push({
              session,
              id,
              clones,
              remoteUrl: `${gitServer.url}/${name}.git`,
              runs,
              warmup,
              log: what => log(`${email}: ${what}`)
            });
          }

          const samples = {};
          const baselines = {};
          const started = performance.now();
          await Promise.all(contexts.map(context => measureBasics(context, { samples, baselines })));

          let large;
          if (largeRepo !== undefined) {
            const first = contexts[0];
            const name = `${options.name}-large`;
            large = { shape: shapeOf(largeRepo), source: workspacePath(largeRepo) };
            createLargeRemote(work, name, largeRepo);
            log(`${first.session.email}: adding ${name}; the clone of 100,000 files takes a while`);
            const cloneStarted = performance.now();
            const id = await first.session.addRepository(name, `${gitServer.url}/${name}.git`);
            large.cloneSeconds = Math.round((performance.now() - cloneStarted) / 1000);
            await measureLarge({ ...first, id, cold: options.cold, coldRuns }, { samples });
          }

          const rows = resultRows(samples, baselines);
          const result = {
            host,
            url: options.url,
            users: emails.length,
            runs,
            warmup,
            minutes: Math.round((performance.now() - started) / 6000) / 10,
            large,
            rows
          };
          print(options.json, result, () =>
            [
              '',
              hostLine(host),
              `Instance: ${options.url}; ${emails.length} user(s) at once; ${runs} runs after ${warmup} warm-up runs`,
              ...(large
                ? [
                  `Large repository: ${large.source}, ${large.shape.files.toLocaleString('en')} files, ${
                    large.shape.folders.toLocaleString('en')
                  } folders, `
                  + `${(large.shape.totalBytes / 1000 ** 3).toFixed(2)} GB; cloned in ${large.cloneSeconds} s`
                ]
                : []),
              '',
              table(resultTable(rows)),
              '',
              'Durations are the server\'s own (Server-Timing), the network left out; NF-2.6 is the job, from its',
              'request to job.finished, less the median of plain git against the same remote.',
              ...(options.cold ? [] : [ 'Cold rows need --cold (as root, on the instance\'s host).' ])
            ].join('\n'));
          return rows.every(row => row.pass) ? 0 : 1;
        } finally {
          for (const session of sessions) {
            session.close();
          }
          await gitServer.close();
        }
      }
    },
    scale: {
      usage: '--data-dir <dir> [--repos-dir <dir>] [--users 49] [--repositories 50] [--json]',
      summary: 'Fills a stopped instance with users and small repositories with working copies (NF-1.1, NF-1.3).',
      help: [
        'The instance must be stopped, onboarded, and hold only its first administrator. The seeded',
        'users are perf-user-01@example.invalid and on, with the administrator\'s password; every user,',
        'the administrator included, gets --repositories ready repositories with a small working copy',
        'each. Their remote is never reachable, so no fetch of theirs reaches the network.',
        '',
        '--data-dir   the instance\'s data directory, in the workspace',
        '--repos-dir  its FRONT_BURNER_REPOS_DIR, when set',
        '--users      users to add besides the administrator (default 49: 50 in all)',
        '--repositories  repositories per user (default 50: 2,500 working copies in all)',
        '',
        'Then time the start with `perf-api.mjs ready` and measure with `run`.'
      ].join('\n'),
      options: {
        'data-dir': { type: 'string' },
        'repos-dir': { type: 'string' },
        users: { type: 'string', default: '49' },
        repositories: { type: 'string', default: '50' },
        json: { type: 'boolean' }
      },
      run(options) {
        if (!options['data-dir']) {
          throw new UsageError('Name the data directory with --data-dir.');
        }
        const dataDir = resolveInWorkspace(options['data-dir']);
        const reposRoot = options['repos-dir'] === undefined ? dataDir : resolveInWorkspace(options['repos-dir']);
        const filled = fillDataDir(dataDir, {
          users: wholeNumber(options.users, '--users', 0),
          repositories: wholeNumber(options.repositories, '--repositories', 1),
          reposRoot,
          log
        });
        print(
          options.json,
          filled,
          () =>
            `Filled ${workspacePath(dataDir)}: ${filled.users} users, ${
              filled.workingCopies.toLocaleString('en')
            } working copies.`
        );
      }
    },
    ready: {
      usage: '--url <instance> [--timeout 600] [--json]',
      summary: 'Waits until /api/health/ready answers 200 and prints the seconds since the command started.',
      help: [
        'Start it, then start the instance at once, to time the start until ready, which recovery stretches',
        'by visiting every working copy (NF-9.4):',
        '  perf-api.mjs ready --url http://127.0.0.1:3000 & docker compose start front-burner'
      ].join('\n'),
      options: {
        url: { type: 'string' },
        timeout: { type: 'string', default: '600' },
        json: { type: 'boolean' }
      },
      async run(options) {
        if (!options.url) {
          throw new UsageError('Name the instance with --url.');
        }
        const seconds = await waitUntilReady(options.url, {
          timeoutMs: wholeNumber(options.timeout, '--timeout', 1) * 1000
        });
        print(options.json, { seconds }, () => `Ready after ${seconds.toFixed(1)} s`);
      }
    }
  }
});
