import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitOperationError, WORKING_COPY_FOLDER_GONE } from '../engine/git-errors';
import { GitRunner } from './git-runner';

/** Processes whose command line contains every one of `parts`, as separate arguments. */
function processesRunning(...parts: string[]): number[] {
  const found: number[] = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    try {
      const argv = readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0');
      if (parts.every(part => argv.some(arg => arg.includes(part)))) {
        found.push(Number(entry));
      }
    } catch {
      // The process ended meanwhile.
    }
  }
  return found;
}

// Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
describe.skipIf(process.platform === 'win32')('GitRunner', () => {
  const runner = new GitRunner();
  const savedEnv = { ...process.env };
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fb-runner-spec-'));
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs git with the hardening', async () => {
    expect((await runner.run([ 'init', '-q', dir ], { timeoutMs: 10_000 })).exitCode).toBe(0);

    const result = await runner.run([ 'config', '--list', '--show-origin' ], { cwd: dir, timeoutMs: 10_000 });

    expect(result.exitCode).toBe(0);
    const lines = result.stdout.trim().split('\n');
    for (
      const setting of [
        'protocol.allow=never',
        'protocol.https.allow=always',
        'protocol.ssh.allow=always',
        'core.hookspath=/dev/null',
        'core.fsmonitor=false',
        'core.autocrlf=false',
        'submodule.recurse=false',
        'credential.helper='
      ]
    ) {
      expect(lines).toContain(`command line:\t${setting}`);
    }
    // Nothing from a system or global file: only the repository's own config.
    const files = lines.filter(line => line.startsWith('file:')).map(line => line.split('\t')[0]);
    expect(new Set(files)).toEqual(new Set([ 'file:.git/config' ]));
  });

  it('never runs a program that the repository\'s own config names as its fsmonitor', async () => {
    execFileSync('git', [ 'init', '-q', '-b', 'main', dir ]);
    writeFileSync(join(dir, 'a.md'), 'a\n');
    execFileSync('git', [ '-C', dir, 'add', 'a.md' ]);
    const marker = join(dir, '..', `${dir.split('/').pop() ?? ''}-fsmonitor-ran`);
    const hook = join(dir, 'fsmonitor.sh');
    writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    execFileSync('git', [ '-C', dir, 'config', 'core.fsmonitor', hook ]);

    try {
      const result = await runner.run([ 'status', '--porcelain' ], { cwd: dir, timeoutMs: 10_000 });

      expect(result.exitCode).toBe(0);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(marker, { force: true });
    }
  });

  it('passes stderr on as git writes it, and still collects it', async () => {
    const seen: string[] = [];

    const result = await runner.run([ 'ls-remote', join(dir, 'no-such-repository') ], {
      timeoutMs: 10_000,
      onStderr: text => seen.push(text)
    });

    expect(seen.join('')).toContain('fatal:');
    expect(result.stderr).toBe(seen.join(''));
  });

  it('starts with an empty environment', async () => {
    process.env['GIT_AUTHOR_NAME'] = 'Leaked Name';
    process.env['GIT_AUTHOR_EMAIL'] = 'leaked@example.com';
    process.env['FB_RUNNER_SPEC_LEAK'] = 'leaked';

    const ident = await runner.run([ 'var', 'GIT_AUTHOR_IDENT' ], { timeoutMs: 10_000 });
    const env = await runner.run([ '-c', 'alias.env=!env', 'env' ], { timeoutMs: 10_000 });

    expect(ident.stdout).not.toContain('Leaked');
    expect(env.exitCode).toBe(0);
    expect(env.stdout).not.toContain('leaked');
    const names = env.stdout.trim().split('\n').map(line => line.split('=')[0]);
    expect(names).toEqual(
      expect.arrayContaining([
        'PATH',
        'HOME',
        'GIT_CONFIG_NOSYSTEM',
        'GIT_CONFIG_GLOBAL',
        'GIT_TERMINAL_PROMPT',
        'LC_ALL'
      ])
    );
    expect(env.stdout).toContain('GIT_CONFIG_GLOBAL=/dev/null\n');
    expect(env.stdout).toContain('GIT_TERMINAL_PROMPT=0\n');
  });

  it('gives each run a fresh private home and removes it', async () => {
    const result = await runner.run([ '-c', 'alias.home=!stat -c %a "$HOME" && echo "$HOME"', 'home' ], {
      timeoutMs: 10_000
    });

    const [ mode, home ] = result.stdout.trim().split('\n');
    expect(mode).toBe('700');
    expect(() => readdirSync(home ?? '')).toThrow();
  });

  it('passes GIT_SSL_CAINFO through', async () => {
    process.env['GIT_SSL_CAINFO'] = '/etc/fb-test/ca.pem';
    delete process.env['SSL_CERT_DIR'];

    const env = await runner.run([ '-c', 'alias.env=!env', 'env' ], {
      env: { FB_EXTRA: 'yes' },
      timeoutMs: 10_000
    });

    expect(env.stdout).toContain('GIT_SSL_CAINFO=/etc/fb-test/ca.pem\n');
    expect(env.stdout).toContain('FB_EXTRA=yes\n');
    expect(env.stdout).not.toContain('SSL_CERT_DIR=');
  });

  // Reads /proc, which only Linux has.
  it.skipIf(process.platform !== 'linux')('kills the whole process group at the timeout', async () => {
    const started = Date.now();

    const result = await runner.run([ '-c', 'alias.slow=!sleep 31.7', 'slow' ], { timeoutMs: 200 });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(processesRunning('sleep', '31.7')).toEqual([]);
  });

  // Reads /proc, which only Linux has.
  it.skipIf(process.platform !== 'linux')('kills every running git on killAll', async () => {
    const run = runner.run([ '-c', 'alias.slow=!sleep 32.3', 'slow' ], { timeoutMs: 60_000 });
    await new Promise(resolve => setTimeout(resolve, 200));

    await runner.killAll();
    const result = await run;

    expect(result.exitCode).toBeNull();
    expect(processesRunning('sleep', '32.3')).toEqual([]);
  });

  // Reads /proc, which only Linux has.
  it.skipIf(process.platform !== 'linux')('kills the whole process group when its signal is aborted', async () => {
    const controller = new AbortController();
    const run = runner.run([ '-c', 'alias.slow=!sleep 33.1', 'slow' ], {
      timeoutMs: 60_000,
      signal: controller.signal
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    const started = Date.now();

    controller.abort();
    const result = await run;

    expect(result).toMatchObject({ aborted: true, timedOut: false, exitCode: null });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(processesRunning('sleep', '33.1')).toEqual([]);
  });

  it('does not start git once its signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runner.run([ 'version' ], { timeoutMs: 10_000, signal: controller.signal });

    expect(result).toMatchObject({ aborted: true, exitCode: null, stdout: '' });
  });

  it('a killed git is not taken for a damaged working copy', async () => {
    const controller = new AbortController();
    controller.abort();

    // A folder without .git: a failed git there would be working-copy-missing.
    await expect(runner.run([ 'status' ], { cwd: dir, timeoutMs: 10_000, signal: controller.signal })).resolves
      .toMatchObject({ aborted: true });
  });

  it('caps the output', async () => {
    const result = await runner.run([ '-c', 'alias.big=!head -c 300000 /dev/zero | tr "\\0" a', 'big' ], {
      maxOutputBytes: 1000,
      timeoutMs: 10_000
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBe(1000);
    expect(result.stdoutBytes).toBe(300_000);
  });

  it('writes stdin', async () => {
    const result = await runner.run([ 'hash-object', '--stdin' ], { stdin: 'hello\n', timeoutMs: 10_000 });

    expect(result.stdout.trim()).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('redacts stderr', async () => {
    const result = await runner.run([ '-c', 'alias.leak=!echo https://u:p4ss@example.com/x >&2', 'leak' ], {
      timeoutMs: 10_000
    });

    expect(result.stderr).not.toContain('p4ss');
    expect(result.stderr).toContain('https://***@example.com/x');
  });

  describe('a full disk (NF-9.8)', () => {
    const fail = (stderr: string) => [ '-c', `alias.full=!echo "${stderr}" >&2; exit 128`, 'full' ];

    it('git\'s "No space left on device" is storage-full', async () => {
      await runner.run([ 'init', '-q', dir ], { timeoutMs: 10_000 });

      const error = await runner.run(fail('fatal: unable to write new index file: No space left on device'), {
        cwd: dir,
        timeoutMs: 10_000
      }).catch((caught: unknown) => caught as GitOperationError);

      expect(error).toBeInstanceOf(GitOperationError);
      expect((error as GitOperationError).code).toBe('storage-full');
      expect((error as GitOperationError).detail).toContain('No space left on device');
    });

    it('a used-up quota is storage-full too, also without a working copy', async () => {
      await expect(runner.run(fail('error: unable to create temporary file: Disk quota exceeded'), {
        timeoutMs: 10_000
      })).rejects.toMatchObject({ code: 'storage-full' });
    });

    it('the remote\'s full disk is not ours', async () => {
      const result = await runner.run(fail('remote: fatal: write error: No space left on device'), {
        timeoutMs: 10_000
      });

      expect(result.exitCode).toBe(128);
    });
  });

  describe('a working copy that is gone (RM-6)', () => {
    const failure = (run: Promise<unknown>) =>
      run.then(() => {
        throw new Error('did not throw');
      }, (error: unknown) => error as GitOperationError);

    it('reports a folder without .git as working-copy-missing, with git\'s message', async () => {
      const error = await failure(runner.run([ 'status' ], { cwd: dir, timeoutMs: 10_000 }));

      expect(error).toBeInstanceOf(GitOperationError);
      expect(error.code).toBe('working-copy-missing');
      expect(error.detail).toMatch(/^fatal: not a git repository/);
    });

    it('reports a folder that is gone as working-copy-missing', async () => {
      const error = await failure(runner.run([ 'status' ], { cwd: join(dir, 'gone'), timeoutMs: 10_000 }));

      expect(error.code).toBe('working-copy-missing');
      expect(error.detail).toBe(WORKING_COPY_FOLDER_GONE);
    });

    it('never uses a repository in a folder above the working copy', async () => {
      await runner.run([ 'init', '-q', dir ], { timeoutMs: 10_000 });
      const workingCopy = join(dir, 'repos', '7');
      mkdirSync(workingCopy, { recursive: true });

      const error = await failure(runner.run([ 'status' ], { cwd: workingCopy, timeoutMs: 10_000 }));

      expect(error.code).toBe('working-copy-missing');
    });

    it('reports a .git file that points nowhere as working-copy-missing', async () => {
      writeFileSync(join(dir, '.git'), `gitdir: ${join(dir, 'nowhere')}\n`);

      const error = await failure(runner.run([ 'status' ], { cwd: dir, timeoutMs: 10_000 }));

      expect(error.code).toBe('working-copy-missing');
    });

    it('does not take a broken submodule for a damaged working copy', async () => {
      const fixtureEnv = {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        HOME: dir,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.com',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.com'
      };
      const git = (cwd: string, ...args: string[]) =>
        execFileSync('git', args, { cwd, env: fixtureEnv, stdio: 'pipe' });
      const lib = join(dir, 'lib');
      const workingCopy = join(dir, 'copy');
      for (const repository of [ lib, workingCopy ]) {
        mkdirSync(repository);
        git(repository, 'init', '-q', '-b', 'main');
        git(repository, 'commit', '-q', '--allow-empty', '-m', 'first');
      }
      git(workingCopy, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'lib');
      git(workingCopy, 'commit', '-q', '-m', 'submodule');
      rmSync(join(workingCopy, '.git', 'modules', 'lib'), { recursive: true, force: true });

      const result = await runner.run([ 'status', '--porcelain=v2' ], { cwd: workingCopy, timeoutMs: 10_000 });

      // git's words differ by version: "not a git repository: …modules/lib" up to 2.47, "gitfile does not point
      // to a valid repository: lib/.git" after. Either way it names the submodule, and the result comes back.
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/^fatal: .*lib/m);
    });

    it('reports a .git file that is not a gitfile as working-copy-missing', async () => {
      writeFileSync(join(dir, '.git'), 'junk\n');

      const error = await failure(runner.run([ 'status' ], { cwd: dir, timeoutMs: 10_000 }));

      expect(error.code).toBe('working-copy-missing');
      expect(error.detail).toMatch(/^fatal: invalid gitfile format/);
    });

    it('gives the result of any other failure', async () => {
      await runner.run([ 'init', '-q', dir ], { timeoutMs: 10_000 });
      writeFileSync(join(dir, '.git', 'index.lock'), '');

      const result = await runner.run([ 'rev-parse', '--verify', 'nope' ], { cwd: dir, timeoutMs: 10_000 });
      const locked = await runner.run([ 'add', '.' ], { cwd: dir, timeoutMs: 10_000 });

      expect(result.exitCode).not.toBe(0);
      expect(locked.exitCode).not.toBe(0);
      expect(locked.stderr).toContain('index.lock');
    });

    it('gives the result of a git without a working copy that failed', async () => {
      const result = await runner.run([ 'rev-parse', '--verify', 'nope' ], { timeoutMs: 10_000 });

      expect(result.exitCode).not.toBe(0);
    });
  });
});
