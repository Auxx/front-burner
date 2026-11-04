import { execFile, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { UsageError } from './cli.mjs';
import { resolveInWorkspace, WORKSPACE_ROOT, workspacePath } from './workspace.mjs';

/** Where reports go unless `--out` says otherwise; one folder per scenario. */
export const DEFAULT_OUT = 'tmp/ai-tools/mem-profile';

/** Nx options shared by every scenario: no cache (or nothing would run) and task output prefixed with its project. */
const NX = '--skipNxCache --outputStyle=stream';

/**
 * The scenarios `run` can profile. `prepare` runs first and is not measured
 * (the builds the e2e targets depend on); `command` is what is measured.
 */
export const SCENARIOS = {
  unit: {
    summary: 'Every unit test target, as `npm test` runs them',
    command: `npx nx run-many -t test ${NX}`
  },
  'unit-web': {
    summary: 'Unit tests of the web client and its libraries (jsdom and Angular)',
    command: `npx nx run-many -t test --projects=web,web-*,ui ${NX}`
  },
  'unit-server': {
    summary: 'Unit tests of the server, its libraries and the shared libraries',
    command: `npx nx run-many -t test --projects=server,server-*,shared-* ${NX}`
  },
  storybook: {
    summary: 'Every story of the ui library as a test in Chromium',
    command: `npx nx run ui:test-storybook ${NX}`
  },
  'e2e-server': {
    summary: 'API e2e tests against built servers (the build is not measured)',
    prepare: 'npx nx run server:build',
    command: `npx nx run server-e2e:e2e --excludeTaskDependencies ${NX}`
  },
  'e2e-web': {
    summary: 'Playwright e2e tests on the local browsers (the builds are not measured)',
    prepare: 'npx nx run-many -t build --projects=web,server',
    command: `npx nx run web-e2e:e2e --excludeTaskDependencies ${NX}`
  },
  'e2e-web-chromium': {
    summary: 'Playwright e2e tests on Chromium only, as CI runs them on pull requests',
    prepare: 'npx nx run-many -t build --projects=web,server',
    command: `npx nx run web-e2e:e2e --excludeTaskDependencies ${NX}`,
    env: { E2E_BROWSERS: 'chromium' }
  },
  all: {
    summary: 'Unit, Storybook and e2e tests with their builds, as the nightly CI run does',
    command: `npx nx run-many -t test test-storybook e2e ${NX}`
  }
};

/** The scenario called `name`; throws `UsageError` naming the known ones. */
export function findScenario(name) {
  if (!Object.hasOwn(SCENARIOS, name)) {
    throw new UsageError(`Unknown scenario: ${name}. Known: ${Object.keys(SCENARIOS).join(', ')}`);
  }
  return SCENARIOS[name];
}

// Options such as `--parallel=1`, `--projects=web-*` or `--maxWorkers=50%`; no
// quotes, spaces or other characters that the shell would read.
const EXTRA_ARG = /^[\w@:=.,/+*-]+%?$/;

/**
 * The command line of a scenario with `extraArgs` appended. Each argument is
 * checked, since the command runs in a shell, and quoted on POSIX so that `*`
 * is not expanded.
 */
export function commandLine(scenario, extraArgs = [], platform = process.platform) {
  for (const arg of extraArgs) {
    if (!EXTRA_ARG.test(arg)) {
      throw new UsageError(`Extra argument has characters the shell would read: ${arg}`);
    }
  }
  const quoted = platform === 'win32' ? extraArgs : extraArgs.map(arg => `'${arg}'`);
  return [ scenario.command, ...quoted ].join(' ');
}

/**
 * `NAME=value` settings, such as `VITEST_MAX_WORKERS=4`, as an object. They
 * reach the command through its environment, not the shell, so any value is
 * safe; the names are checked so that a typo fails loudly.
 */
export function parseEnv(settings) {
  return Object.fromEntries(settings.map(setting => {
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(setting);
    if (!match) {
      throw new UsageError(`An environment setting is NAME=value, with NAME in capitals: ${setting}`);
    }
    return [ match[1], match[2] ];
  }));
}

const LABEL = /^[a-z0-9][a-z0-9-]{0,39}$/i;

/** A file-name-safe local timestamp, such as `2026-11-04T14-03-22`. */
export function timestamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}-${
    pad(date.getMinutes())
  }-${pad(date.getSeconds())}`;
}

/**
 * The report, data and log files of one run: `<out>/<scenario>/<stamp>[-label]`
 * with `.md`, `.json` and `.log`. `out` must stay in the workspace.
 */
export function reportPaths({ out = DEFAULT_OUT, scenario, stamp, label }) {
  findScenario(scenario);
  if (label !== undefined && !LABEL.test(label)) {
    throw new UsageError(`A label is up to 40 letters, digits and hyphens: ${label}`);
  }
  const dir = resolveInWorkspace(join(out, scenario));
  const base = join(dir, label ? `${stamp}-${label}` : stamp);
  return { dir, report: `${base}.md`, data: `${base}.json`, log: `${base}.log` };
}

const COMMAND_LENGTH = 300;

/**
 * Parses `ps -A -o pid=,ppid=,rss=,lstart=,args=` in the C locale (RSS in KiB,
 * start time such as `Wed Nov  4 12:31:29 2026`) into process records.
 */
export function parsePosixProcesses(text) {
  return text.split('\n').filter(line => line.trim()).map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})\s(.*)$/.exec(line);
    if (!match) {
      throw new Error(`Unexpected line from ps: ${line}`);
    }
    const command = match[5].trim();
    return {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      started: match[4],
      name: basename(command.split(' ')[0] ?? ''),
      rss: Number(match[3]) * 1024,
      private: null,
      command: command.slice(0, COMMAND_LENGTH)
    };
  });
}

/** Parses one JSON line of the PowerShell sampler (sizes in bytes) into process records. */
export function parseWindowsProcesses(line) {
  const list = JSON.parse(line);
  if (!Array.isArray(list)) {
    throw new Error(`Unexpected output from the PowerShell sampler: ${line.slice(0, 200)}`);
  }
  return list.map(p => {
    if (
      typeof p.pid !== 'number' || typeof p.ppid !== 'number' || typeof p.started !== 'string'
      || typeof p.name !== 'string'
    ) {
      throw new Error(`Unexpected process from the PowerShell sampler: ${JSON.stringify(p).slice(0, 200)}`);
    }
    return {
      pid: p.pid,
      ppid: p.ppid,
      started: p.started,
      name: p.name,
      rss: Number(p.rss) || 0,
      private: Number(p.private) || 0,
      command: p.command ?? ''
    };
  });
}

/**
 * The processes of `processes` that belong to the tree of the profiled
 * command. `known` maps every PID found so far to its start time (`null` for
 * the root until it is first seen) and grows with each call, so that processes
 * whose parent has exited (such as test workers of a finished runner) are still
 * found through the parent's PID. A known PID now used by a process that
 * started at another time has been reused by the system and is left out. The
 * name is no identity: on POSIX, `sh -c` execs the command in its own process.
 */
export function treeOf(processes, known) {
  const byPid = new Map(processes.map(p => [ p.pid, p ]));
  const children = new Map();
  for (const p of processes) {
    children.set(p.ppid, [ ...(children.get(p.ppid) ?? []), p ]);
  }
  for (const [ pid, started ] of known) {
    if (started === null && byPid.has(pid)) {
      known.set(pid, byPid.get(pid).started);
    }
  }
  const belongs = pid => !byPid.has(pid) || byPid.get(pid).started === known.get(pid);
  const queue = [ ...known.keys() ].filter(belongs);
  while (queue.length) {
    for (const child of children.get(queue.shift()) ?? []) {
      if (!known.has(child.pid) && child.pid !== child.ppid) {
        known.set(child.pid, child.started);
        queue.push(child.pid);
      }
    }
  }
  return processes.filter(p => known.has(p.pid) && known.get(p.pid) === p.started);
}

/** What a process is in a test run, from its name and command line. */
export function categorise({ name, command }) {
  const exe = name.toLowerCase().replace(/\.exe$/, '');
  const args = command.replaceAll('\\', '/').toLowerCase();
  if (/chrom|headless_shell|firefox|webkit|msedge|minibrowser/.test(exe)) {
    return 'browser';
  }
  if (exe === 'node' || exe === 'nodejs') {
    if (args.includes('dist/apps/server/main.js')) {
      return 'server instance';
    }
    for (
      const [ needle, category ] of [
        [ 'vitest', 'vitest' ],
        [ 'playwright', 'playwright' ],
        [ '@angular/', 'angular' ],
        [ 'webpack', 'webpack' ],
        [ 'npm-cli', 'npm' ],
        [ 'npx-cli', 'npm' ],
        [ '/nx/', 'nx' ]
      ]
    ) {
      if (args.includes(needle)) {
        return category;
      }
    }
    return 'node (other)';
  }
  if ([ 'cmd', 'sh', 'bash', 'conhost', 'openconsole', 'powershell', 'pwsh' ].includes(exe)) {
    return 'shell';
  }
  return exe;
}

/**
 * Collects samples into a summary without keeping every process of every
 * sample. `metric` is the size the peak is measured by: `private` (committed
 * memory, on Windows) or `rss`.
 */
export function createAccumulator(metric) {
  const samples = [];
  const categories = new Map();
  let peak = null;
  let mostProcesses = { t: 0, count: 0 };
  let peakRss = { t: 0, bytes: 0 };
  let systemPeak = { t: 0, used: 0 };

  return {
    add({ t, processes, systemUsed }) {
      const sample = { t, count: processes.length, rss: 0, private: 0, systemUsed, categories: {} };
      for (const p of processes) {
        const category = p.category ?? categorise(p);
        sample.rss += p.rss;
        sample.private += p.private ?? 0;
        const c = sample.categories[category] ??= { count: 0, rss: 0, private: 0 };
        c.count++;
        c.rss += p.rss;
        c.private += p.private ?? 0;
      }
      samples.push(sample);
      for (const [ name, c ] of Object.entries(sample.categories)) {
        const highest = categories.get(name) ?? { bytes: 0, count: 0 };
        categories.set(name, { bytes: Math.max(highest.bytes, c[metric]), count: Math.max(highest.count, c.count) });
      }
      if (!peak || sample[metric] > peak.sample[metric]) {
        peak = {
          sample,
          processes: processes.map(p => ({ ...p, category: p.category ?? categorise(p) }))
            .sort((a, b) => b[metric] - a[metric])
        };
      }
      if (sample.count > mostProcesses.count) {
        mostProcesses = { t, count: sample.count };
      }
      if (sample.rss > peakRss.bytes) {
        peakRss = { t, bytes: sample.rss };
      }
      if (systemUsed > systemPeak.used) {
        systemPeak = { t, used: systemUsed };
      }
    },
    result(top = 15) {
      return {
        metric,
        sampleCount: samples.length,
        peak: peak
          ? {
            t: peak.sample.t,
            bytes: peak.sample[metric],
            rss: peak.sample.rss,
            count: peak.sample.count,
            categories: peak.sample.categories
          }
          : null,
        peakRss,
        mostProcesses,
        systemPeak,
        categories: [ ...categories ].map(([ name, c ]) => ({ name, ...c })).sort((a, b) => b.bytes - a.bytes),
        top: (peak?.processes ?? []).slice(0, top).map(({ pid, category, rss, private: priv, command }) => ({
          pid,
          category,
          rss,
          private: priv,
          command
        })),
        samples
      };
    }
  };
}

/**
 * At most `rows` samples for the timeline, spread over the run: the largest
 * sample of each stretch, so that no peak is lost. Always keeps the last.
 */
export function timeline(samples, metric, rows = 40) {
  if (samples.length <= rows) {
    return samples;
  }
  const size = samples.length / rows;
  const picked = [];
  for (let i = 0; i < rows; i++) {
    const stretch = samples.slice(Math.floor(i * size), Math.floor((i + 1) * size));
    picked.push(stretch.reduce((a, b) => (b[metric] > a[metric] ? b : a)));
  }
  return picked;
}

const MB = 1024 * 1024;

/** `1.23 GB` from 1 GB up, `456 MB` below. */
export function formatBytes(bytes) {
  return bytes >= 1024 * MB ? `${(bytes / 1024 / MB).toFixed(2)} GB` : `${Math.round(bytes / MB)} MB`;
}

/** `1m 03s` or `42s`. */
export function formatSeconds(seconds) {
  const s = Math.round(seconds);
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function markdownTable(header, rows) {
  const cell = value => String(value).replaceAll('|', '\\|');
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`)
  ].join('\n');
}

/** The Markdown report of a run, from the summary that `runProfile` returns. */
export function renderReport(run) {
  const { summary } = run;
  const metric = summary.metric;
  const metricName = metric === 'private' ? 'Private' : 'RSS';
  const lines = [
    `# Memory profile: ${run.scenario}${run.label ? ` (${run.label})` : ''}`,
    '',
    markdownTable([ 'Run', '' ], [
      [ 'Command', `\`${run.command}\`` ],
      ...(run.prepare ? [ [ 'Prepared with (not measured)', `\`${run.prepare}\`` ] ] : []),
      ...(Object.keys(run.env).length
        ? [ [ 'Environment', Object.entries(run.env).map(([ k, v ]) => `\`${k}=${v}\``).join(', ') ] ]
        : []),
      [ 'Started', run.startedAt ],
      [ 'Duration', formatSeconds(run.durationSeconds) ],
      [ 'Exit code', `${run.exitCode}${run.interrupted ? ' (interrupted)' : ''}` ],
      [ 'Samples', `${summary.sampleCount}, every ${run.intervalMs} ms` ],
      [
        'Machine',
        `${run.machine.platform}, ${run.machine.cpus} CPUs, ${
          formatBytes(run.machine.totalMemory)
        } RAM, Node ${run.machine.node}`
      ],
      [ 'Log', `[${basename(run.files.log)}](${basename(run.files.log)})` ]
    ]),
    ''
  ];

  if (!summary.peak) {
    lines.push('No samples were taken: the command ended before the first one.');
    return `${lines.join('\n')}\n`;
  }

  lines.push(
    '## Peak',
    '',
    `- **${metricName} memory of the run: ${formatBytes(summary.peak.bytes)}** at ${
      formatSeconds(summary.peak.t)
    }, in ${summary.peak.count} processes.`,
    ...(metric === 'private'
      ? [
        `- Working set: highest ${formatBytes(summary.peakRss.bytes)} at ${
          formatSeconds(summary.peakRss.t)
        } (counts shared pages once per process, so it overstates the total).`
      ]
      : []),
    `- Most processes at once: ${summary.mostProcesses.count} at ${formatSeconds(summary.mostProcesses.t)}.`,
    `- System memory in use: highest ${formatBytes(summary.systemPeak.used)} of ${
      formatBytes(run.machine.totalMemory)
    } at ${formatSeconds(summary.systemPeak.t)} (everything on the machine, not only this run).`,
    '',
    '## By category',
    '',
    markdownTable(
      [ 'Category', 'At the peak', `Highest ${metricName}`, 'Most processes' ],
      summary.categories.map(c => {
        const atPeak = summary.peak.categories[c.name];
        return [
          c.name,
          atPeak ? `${formatBytes(atPeak[metric])} in ${atPeak.count}` : '-',
          formatBytes(c.bytes),
          c.count
        ];
      })
    ),
    '',
    '## Largest processes at the peak',
    '',
    markdownTable(
      [ 'PID', 'Category', ...(metric === 'private' ? [ 'Private' ] : []), 'Working set', 'Command' ],
      summary.top.map(p => [
        p.pid,
        p.category,
        ...(metric === 'private' ? [ formatBytes(p.private) ] : []),
        formatBytes(p.rss),
        `\`${p.command.replaceAll('`', '\'').slice(0, 160)}\``
      ])
    ),
    '',
    '## Timeline',
    '',
    `The largest sample of each stretch of the run. Log lines start with the same time, to find which tasks ran then.`,
    '',
    markdownTable(
      [ 'Time', 'Processes', metricName, 'System in use', 'Largest category' ],
      timeline(summary.samples, metric).map(s => {
        const [ name, c ] = Object.entries(s.categories).sort((a, b) => b[1][metric] - a[1][metric])[0] ?? [];
        return [
          formatSeconds(s.t),
          s.count,
          formatBytes(s[metric]),
          formatBytes(s.systemUsed),
          name ? `${name} (${formatBytes(c[metric])})` : '-'
        ];
      })
    ),
    ''
  );
  return lines.join('\n');
}

const WINDOWS_SAMPLER = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
while ($null -ne [Console]::In.ReadLine()) {
  $list = foreach ($p in Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name,WorkingSetSize,PrivatePageCount,CommandLine) {
    $command = [string]$p.CommandLine
    if ($command.Length -gt ${COMMAND_LENGTH}) { $command = $command.Substring(0, ${COMMAND_LENGTH}) }
    $started = if ($p.CreationDate) { [string]$p.CreationDate.Ticks } else { '' }
    [pscustomobject]@{ pid = [int]$p.ProcessId; ppid = [int]$p.ParentProcessId; started = $started; name = [string]$p.Name; rss = [long]$p.WorkingSetSize; private = [long]$p.PrivatePageCount; command = $command }
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject @($list) -Compress))
}
`;

/**
 * One long-lived PowerShell that lists every process, with its parent and
 * memory, each time a line is written to it (starting it per sample would cost
 * more than the sample).
 */
function windowsSampler() {
  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(WINDOWS_SAMPLER, 'utf16le').toString('base64')
  ], { stdio: [ 'pipe', 'pipe', 'pipe' ], windowsHide: true });
  const waiting = [];
  let stderr = '';
  let exited = null;
  // A write after the sampler exited fails; the exit handler reports why.
  child.stdin.on('error', () => undefined);
  child.stderr.on('data', data => (stderr += data));
  createInterface({ input: child.stdout }).on('line', line => waiting.shift()?.resolve(line));
  child.on('exit', code => {
    exited = new Error(`The PowerShell sampler exited with code ${code}: ${stderr.trim()}`);
    for (const wait of waiting.splice(0)) {
      wait.reject(exited);
    }
  });
  return {
    async snapshot() {
      if (exited) {
        throw exited;
      }
      const line = await new Promise((resolve, reject) => {
        waiting.push({ resolve, reject });
        child.stdin.write('\n');
      });
      return parseWindowsProcesses(line);
    },
    close() {
      child.stdin.end();
    }
  };
}

const execFileAsync = promisify(execFile);

function posixSampler() {
  return {
    async snapshot() {
      const { stdout } = await execFileAsync('ps', [ '-A', '-o', 'pid=,ppid=,rss=,lstart=,args=' ], {
        env: { ...process.env, LC_ALL: 'C' },
        maxBuffer: 64 * MB
      });
      return parsePosixProcesses(stdout);
    },
    close() {
      // ps runs once per sample; nothing stays open.
    }
  };
}

/** Lists every process of the system, with parent and memory, on this platform. */
export function createSampler(platform = process.platform) {
  return platform === 'win32' ? windowsSampler() : posixSampler();
}

function killTree(child) {
  if (child.exitCode !== null || !child.pid) {
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', [ '/pid', String(child.pid), '/T', '/F' ], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

const ANSI = new RegExp(String.raw`\u001b\[[0-9;?]*[A-Za-z]`, 'g');

/**
 * Runs `command` in a shell from the workspace root. Every line of its output
 * goes to `log`, prefixed with the time since `start`, and to `echo` unless it
 * is null. Resolves with the exit code.
 */
function runLogged(command, { env, log, echo, start, prefix = '' }) {
  const child = spawn(command, {
    cwd: WORKSPACE_ROOT,
    env: { ...process.env, NX_TUI: 'false', ...env },
    shell: true,
    stdio: [ 'ignore', 'pipe', 'pipe' ],
    windowsHide: true
  });
  for (const stream of [ child.stdout, child.stderr ]) {
    createInterface({ input: stream }).on('line', line => {
      const seconds = ((Date.now() - start()) / 1000).toFixed(1).padStart(7);
      log.write(`[${seconds}s] ${prefix}${line.replace(ANSI, '')}\n`);
      echo?.write(`${line}\n`);
    });
  }
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  return { child, done };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Runs a scenario and samples the memory of every process it starts, every
 * `intervalMs`. Writes the Markdown report, the JSON data and the log, and
 * returns the run with its summary. `scenario` is a name from `SCENARIOS`, or
 * `definition` replaces the scenario's own (for tests).
 */
export async function runProfile({
  scenario,
  definition = findScenario(scenario),
  extraArgs = [],
  extraEnv = [],
  label,
  intervalMs = 1000,
  out = DEFAULT_OUT,
  echo = process.stdout,
  now = new Date()
}) {
  const command = commandLine(definition, extraArgs);
  const env = { ...definition.env, ...parseEnv(extraEnv) };
  const files = reportPaths({ out, scenario, stamp: timestamp(now), label });
  mkdirSync(files.dir, { recursive: true });
  const log = createWriteStream(files.log);
  let started = Date.now();

  try {
    if (definition.prepare) {
      log.write(`# prepare (not measured): ${definition.prepare}\n`);
      const prepared = await runLogged(definition.prepare, {
        env,
        log,
        echo,
        start: () => started,
        prefix: '[prepare] '
      })
        .done;
      if (prepared !== 0) {
        throw new Error(
          `Preparing failed with exit code ${prepared}: ${definition.prepare}. See ${workspacePath(files.log)}`
        );
      }
    }

    log.write(`# measured: ${command}\n`);
    const sampler = createSampler();
    const metric = process.platform === 'win32' ? 'private' : 'rss';
    const accumulator = createAccumulator(metric);
    let interrupted = false;
    const onInterrupt = () => (interrupted = true);
    process.on('SIGINT', onInterrupt);

    started = Date.now();
    const startedAt = new Date(started).toISOString();
    const { child, done } = runLogged(command, { env, log, echo, start: () => started });
    const known = new Map([ [ child.pid, null ] ]);
    let finished = false;
    const exit = done.finally(() => (finished = true));

    try {
      while (!finished) {
        const before = Date.now();
        const processes = await sampler.snapshot();
        accumulator.add({
          t: (before - started) / 1000,
          processes: treeOf(processes, known),
          systemUsed: totalmem() - freemem()
        });
        await Promise.race([ exit, sleep(Math.max(0, intervalMs - (Date.now() - before))) ]);
      }
    } catch (error) {
      killTree(child);
      throw error;
    } finally {
      sampler.close();
    }

    const exitCode = await exit;
    process.off('SIGINT', onInterrupt);
    const run = {
      scenario,
      label: label ?? null,
      command,
      prepare: definition.prepare ?? null,
      env,
      startedAt,
      durationSeconds: (Date.now() - started) / 1000,
      exitCode,
      interrupted,
      intervalMs,
      machine: {
        platform: process.platform,
        cpus: availableParallelism(),
        totalMemory: totalmem(),
        node: process.version
      },
      files: Object.fromEntries(Object.entries(files).map(([ key, path ]) => [ key, workspacePath(path) ])),
      summary: accumulator.result()
    };
    writeFileSync(files.report, renderReport(run));
    writeFileSync(files.data, `${JSON.stringify(run, null, 2)}\n`);
    return run;
  } finally {
    await new Promise(resolve => log.end(resolve));
  }
}
