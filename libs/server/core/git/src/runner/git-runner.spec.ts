import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('GitRunner', () => {
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

  it('kills the whole process group at the timeout', async () => {
    const started = Date.now();

    const result = await runner.run([ '-c', 'alias.slow=!sleep 31.7', 'slow' ], { timeoutMs: 200 });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(processesRunning('sleep', '31.7')).toEqual([]);
  });

  it('kills every running git on killAll', async () => {
    const run = runner.run([ '-c', 'alias.slow=!sleep 32.3', 'slow' ], { timeoutMs: 60_000 });
    await new Promise(resolve => setTimeout(resolve, 200));

    await runner.killAll();
    const result = await run;

    expect(result.exitCode).toBeNull();
    expect(processesRunning('sleep', '32.3')).toEqual([]);
  });

  it('caps the output', async () => {
    const result = await runner.run([ '-c', 'alias.big=!head -c 300000 /dev/zero | tr "\\0" a', 'big' ], {
      maxOutputBytes: 1000,
      timeoutMs: 10_000
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBe(1000);
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
});
