import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  categorise,
  commandLine,
  createAccumulator,
  findScenario,
  formatBytes,
  formatSeconds,
  parsePosixProcesses,
  parseWindowsProcesses,
  renderReport,
  reportPaths,
  runProfile,
  SCENARIOS,
  timeline,
  timestamp,
  treeOf
} from './mem-profile.mjs';
import { WORKSPACE_ROOT, workspacePath } from './workspace.mjs';

const MB = 1024 * 1024;
const proc = (pid, ppid, name = 'node.exe', extra = {}) => ({
  pid,
  ppid,
  started: `t${pid}`,
  name,
  rss: 100 * MB,
  private: 80 * MB,
  command: '',
  ...extra
});

describe('mem-profile', () => {
  mkdirSync(join(WORKSPACE_ROOT, 'tmp'), { recursive: true });
  const tmp = mkdtempSync(join(WORKSPACE_ROOT, 'tmp', 'mem-profile-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  describe('scenarios', () => {
    it('measures with the Nx cache skipped, or a cached run would measure nothing', () => {
      for (const scenario of Object.values(SCENARIOS)) {
        expect(scenario.command).toContain('--skipNxCache');
      }
    });

    it('builds the e2e targets before measuring and leaves the builds out of the measured command', () => {
      for (const name of [ 'e2e-server', 'e2e-web', 'e2e-web-chromium' ]) {
        expect(SCENARIOS[name].prepare).toMatch(/build/);
        expect(SCENARIOS[name].command).toContain('--excludeTaskDependencies');
      }
    });

    it('refuses an unknown scenario, naming the known ones', () => {
      expect(() => findScenario('nope')).toThrow(/Unknown scenario: nope\. Known: unit, /);
      expect(() => findScenario('constructor')).toThrow(/Unknown scenario/);
    });
  });

  describe('commandLine', () => {
    const scenario = { command: 'npx nx run-many -t test' };

    it('appends extra arguments, quoted on POSIX so that * is not expanded', () => {
      expect(commandLine(scenario, [ '--parallel=1', '--projects=web-*' ], 'linux'))
        .toBe('npx nx run-many -t test \'--parallel=1\' \'--projects=web-*\'');
      expect(commandLine(scenario, [ '--maxWorkers=50%' ], 'win32')).toBe('npx nx run-many -t test --maxWorkers=50%');
    });

    it('refuses arguments with characters the shell would read', () => {
      for (const arg of [ '--a=b c', '--a;rm', '--a="b"', '--a=\'b\'', '--a=$(x)', '--a=%PATH%', '--a&b', '--a|b' ]) {
        expect(() => commandLine(scenario, [ arg ], 'win32'), arg).toThrow(/characters the shell would read/);
      }
    });
  });

  describe('reportPaths', () => {
    const stamp = timestamp(new Date(2026, 10, 4, 9, 5, 7));

    it('names the files after the scenario, the time and the label', () => {
      expect(stamp).toBe('2026-11-04T09-05-07');
      const paths = reportPaths({ scenario: 'unit', stamp, label: 'parallel-1' });
      expect(workspacePath(paths.report)).toBe('tmp/ai-tools/mem-profile/unit/2026-11-04T09-05-07-parallel-1.md');
      expect(workspacePath(paths.data)).toBe('tmp/ai-tools/mem-profile/unit/2026-11-04T09-05-07-parallel-1.json');
      expect(workspacePath(paths.log)).toBe('tmp/ai-tools/mem-profile/unit/2026-11-04T09-05-07-parallel-1.log');
    });

    it('refuses labels that are not plain names', () => {
      for (const label of [ '../x', 'a b', '', 'a/b', '-x' ]) {
        expect(() => reportPaths({ scenario: 'unit', stamp, label }), label).toThrow(/label/);
      }
    });

    it('refuses an output folder outside the workspace', () => {
      expect(() => reportPaths({ out: '../outside', scenario: 'unit', stamp })).toThrow(/outside the workspace/);
      expect(() => reportPaths({ out: join(WORKSPACE_ROOT, '..'), scenario: 'unit', stamp })).toThrow(
        /outside the workspace/
      );
    });

    it('refuses an output folder reached through a symbolic link out of the workspace', () => {
      const link = join(tmp, 'link');
      try {
        symlinkSync(join(WORKSPACE_ROOT, '..'), link, 'junction');
      } catch {
        return; // Creating links needs a permission this machine does not give.
      }
      expect(() => reportPaths({ out: workspacePath(link), scenario: 'unit', stamp })).toThrow(/outside the workspace/);
    });
  });

  describe('parsing process lists', () => {
    it('reads ps output, with RSS in KiB and the start time', () => {
      const ps = [
        '    1     0  1024 Wed Nov  4 09:00:01 2026 /sbin/init splash',
        '   42     1  2048 Wed Nov  4 12:31:29 2026 /usr/bin/node a.js',
        ''
      ].join('\n');
      expect(parsePosixProcesses(ps)).toEqual([
        {
          pid: 1,
          ppid: 0,
          started: 'Wed Nov  4 09:00:01 2026',
          name: 'init',
          rss: MB,
          private: null,
          command: '/sbin/init splash'
        },
        {
          pid: 42,
          ppid: 1,
          started: 'Wed Nov  4 12:31:29 2026',
          name: 'node',
          rss: 2 * MB,
          private: null,
          command: '/usr/bin/node a.js'
        }
      ]);
    });

    it('throws on a ps line it does not understand', () => {
      expect(() => parsePosixProcesses('PID PPID RSS COMMAND\n')).toThrow(/Unexpected line from ps/);
      expect(() => parsePosixProcesses('  42     1  2048 /usr/bin/node a.js\n')).toThrow(/Unexpected line from ps/);
    });

    it('reads the PowerShell sampler', () => {
      const line = '[{"pid":4,"ppid":0,"started":"638980000000000000","name":"System","rss":1024,"private":512,'
        + '"command":""}]';
      expect(parseWindowsProcesses(line)).toEqual([
        { pid: 4, ppid: 0, started: '638980000000000000', name: 'System', rss: 1024, private: 512, command: '' }
      ]);
      expect(() => parseWindowsProcesses('{"pid":4}')).toThrow(/Unexpected output/);
      expect(() => parseWindowsProcesses('[{"pid":"4"}]')).toThrow(/Unexpected process/);
    });
  });

  describe('treeOf', () => {
    it('finds the root and its descendants, and nothing else', () => {
      const known = new Map([ [ 10, null ] ]);
      const tree = treeOf(
        [ proc(1, 0, 'init'), proc(10, 1, 'cmd.exe'), proc(11, 10), proc(12, 11), proc(20, 1) ],
        known
      );
      expect(tree.map(p => p.pid)).toEqual([ 10, 11, 12 ]);
      expect(known.get(10)).toBe('t10');
    });

    it('still finds workers whose parent has exited', () => {
      const known = new Map([ [ 10, null ] ]);
      treeOf([ proc(10, 1, 'cmd.exe'), proc(11, 10), proc(12, 11, 'chrome.exe') ], known);
      expect(
        treeOf([ proc(10, 1, 'cmd.exe'), proc(12, 11, 'chrome.exe'), proc(13, 12, 'chrome.exe') ], known)
          .map(p => p.pid)
      ).toEqual([ 10, 12, 13 ]);
    });

    it('leaves out a PID that the system reused for another process', () => {
      const known = new Map([ [ 10, null ] ]);
      treeOf([ proc(10, 1, 'cmd.exe'), proc(11, 10) ], known);
      const reused = proc(11, 5, 'node.exe', { started: 'later' });
      expect(treeOf([ proc(10, 1, 'cmd.exe'), reused, proc(30, 11) ], known).map(p => p.pid)).toEqual([ 10 ]);
    });

    it('keeps a process that execs another program, as sh -c does', () => {
      const known = new Map([ [ 10, null ] ]);
      treeOf([ proc(10, 1, 'sh') ], known);
      expect(treeOf([ proc(10, 1, 'node'), proc(11, 10, 'node') ], known).map(p => p.pid)).toEqual([ 10, 11 ]);
    });
  });

  describe('categorise', () => {
    it.each([
      [ 'chrome-headless-shell.exe', 'C:\\x\\chrome-headless-shell.exe --headless', 'browser' ],
      [ 'firefox.exe', 'C:\\ms-playwright\\firefox\\firefox.exe', 'browser' ],
      [ 'node.exe', 'node dist/apps/server/main.js', 'server instance' ],
      [ 'node.exe', 'node C:\\dev\\node_modules\\vitest\\dist\\workers\\forks.js', 'vitest' ],
      [ 'node', '/usr/bin/node node_modules/playwright/lib/common/process.js', 'playwright' ],
      [ 'node.exe', 'node node_modules/@angular/build/src/builders/unit-test/index.js', 'angular' ],
      [ 'node.exe', 'node C:\\nodejs\\node_modules\\npm\\bin\\npx-cli.js nx run-many', 'npm' ],
      [ 'node.exe', 'node C:\\dev\\node_modules\\nx\\bin\\nx.js run-many', 'nx' ],
      [ 'node.exe', 'node other.js', 'node (other)' ],
      [ 'cmd.exe', 'cmd /c npx nx', 'shell' ],
      [ 'git.exe', 'git status', 'git' ]
    ])('%s %s is %s', (name, command, category) => {
      expect(categorise({ name, command })).toBe(category);
    });
  });

  describe('createAccumulator', () => {
    it('keeps the peak by the chosen metric, the highest per category and the largest processes at the peak', () => {
      const accumulator = createAccumulator('private');
      const worker = (pid, mb) => proc(pid, 1, 'node.exe', { private: mb * MB, rss: mb * 2 * MB, command: 'vitest' });
      accumulator.add({ t: 0, processes: [ worker(1, 100) ], systemUsed: 10 * MB });
      accumulator.add({
        t: 1,
        processes: [ worker(1, 100), worker(2, 300), proc(3, 1, 'chrome.exe') ],
        systemUsed: 30 * MB
      });
      accumulator.add({ t: 2, processes: [ worker(1, 50) ], systemUsed: 20 * MB });
      const result = accumulator.result(2);

      expect(result.sampleCount).toBe(3);
      expect(result.peak).toMatchObject({ t: 1, bytes: 480 * MB, count: 3 });
      expect(result.mostProcesses).toEqual({ t: 1, count: 3 });
      expect(result.systemPeak).toEqual({ t: 1, used: 30 * MB });
      expect(result.categories).toEqual([
        { name: 'vitest', bytes: 400 * MB, count: 2 },
        { name: 'browser', bytes: 80 * MB, count: 1 }
      ]);
      expect(result.top.map(p => p.pid)).toEqual([ 2, 1 ]);
    });

    it('has no peak without samples', () => {
      expect(createAccumulator('rss').result().peak).toBeNull();
    });
  });

  describe('timeline', () => {
    it('keeps the largest sample of each stretch', () => {
      const samples = Array.from({ length: 100 }, (_, t) => ({ t, rss: t === 37 ? 1000 : t }));
      const picked = timeline(samples, 'rss', 10);
      expect(picked).toHaveLength(10);
      expect(picked[3]).toEqual({ t: 37, rss: 1000 });
      expect(picked.at(-1).t).toBe(99);
    });
  });

  it('formats sizes and times', () => {
    expect(formatBytes(512 * MB)).toBe('512 MB');
    expect(formatBytes(1536 * MB)).toBe('1.50 GB');
    expect(formatSeconds(42)).toBe('42s');
    expect(formatSeconds(63)).toBe('1m 03s');
  });

  it('renders a report that says when nothing was sampled', () => {
    const report = renderReport({
      scenario: 'unit',
      label: null,
      command: 'npx nx run-many -t test',
      prepare: null,
      env: {},
      startedAt: '2026-11-04T09:00:00.000Z',
      durationSeconds: 0.1,
      exitCode: 0,
      interrupted: false,
      intervalMs: 1000,
      machine: { platform: 'win32', cpus: 20, totalMemory: 32 * 1024 * MB, node: 'v24.22.1' },
      files: { log: 'tmp/ai-tools/mem-profile/unit/x.log' },
      summary: createAccumulator('private').result()
    });
    expect(report).toContain('# Memory profile: unit');
    expect(report).toContain('[x.log](x.log)');
    expect(report).toContain('No samples were taken');
  });

  it('profiles a real command: the processes it starts, their memory, the report and the log', async () => {
    // A parent that starts a child holding about 200 MB for 3 s. Scripts in
    // files, since cmd and sh quote `-e` code differently.
    const child = join(tmp, 'child.cjs');
    const parent = join(tmp, 'parent.cjs');
    writeFileSync(
      child,
      'const b = Buffer.alloc(200 * 1024 * 1024, 1);\nconsole.log(\'held\', b.length);\nsetTimeout(() => {}, 3000);\n'
    );
    writeFileSync(
      parent,
      `require('node:child_process').spawn(process.execPath, [ ${JSON.stringify(child)} ], { stdio: 'inherit' })\n`
        + '  .on(\'exit\', code => process.exit(code));\n'
    );
    const run = await runProfile({
      scenario: 'unit',
      definition: { command: `"${process.execPath}" "${parent}"` },
      label: 'spec',
      intervalMs: 250,
      out: workspacePath(tmp),
      echo: null
    });

    expect(run.exitCode).toBe(0);
    expect(run.summary.sampleCount).toBeGreaterThan(2);
    expect(run.summary.mostProcesses.count).toBeGreaterThanOrEqual(2);
    expect(run.summary.peak.bytes).toBeGreaterThan(150 * MB);
    for (const file of Object.values(run.files)) {
      expect(existsSync(join(WORKSPACE_ROOT, file)), file).toBe(true);
    }
    expect(readFileSync(join(WORKSPACE_ROOT, run.files.log), 'utf8')).toMatch(/^\[\s+[\d.]+s\] held 209715200$/m);
    expect(readFileSync(join(WORKSPACE_ROOT, run.files.report), 'utf8')).toContain('## Largest processes at the peak');
  }, 60_000);
});
