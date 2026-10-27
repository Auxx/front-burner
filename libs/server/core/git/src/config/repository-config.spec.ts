import { chmodSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitRunner } from '../runner/git-runner';
import { assertHelpersExecutable, assertSafeRepositoryConfig, UnsafeRepositoryConfigError } from './repository-config';

describe('assertSafeRepositoryConfig', () => {
  const runner = new GitRunner();
  let dir: string;

  const git = async (...args: string[]) => {
    const result = await runner.run(args, { cwd: dir, timeoutMs: 10_000 });
    expect(result.exitCode).toBe(0);
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fb-config-spec-'));
    await git('init', '-q');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a clean config', async () => {
    await git('config', 'remote.origin.url', 'https://example.com/o/r.git');
    await git('config', 'http.sslVerify', 'true');

    await expect(assertSafeRepositoryConfig(runner, dir)).resolves.toBeUndefined();
  });

  describe('refuses a repository config that bypasses the proxy', () => {
    it.each([
      'http.proxy',
      'http.https://x.proxy',
      'remote.origin.proxy',
      'core.gitProxy',
      'core.sshCommand',
      'url.x.insteadOf',
      'url.x.pushInsteadOf',
      'include.path',
      'includeIf.gitdir:/.path',
      'http.curloptResolve'
    ])('%s', async key => {
      await git('config', key, 'secret-looking-value');

      const error = await assertSafeRepositoryConfig(runner, dir).catch(caught => caught);

      expect(error).toBeInstanceOf(UnsafeRepositoryConfigError);
      // git lower-cases section and variable names, not subsections.
      expect((error as UnsafeRepositoryConfigError).keys.map(name => name.toLowerCase())).toEqual([
        key.toLowerCase()
      ]);
      expect((error as Error).message).not.toContain('secret-looking-value');
    });
  });

  it('follows includes', async () => {
    const included = join(dir, 'extra.config');
    await runner.run([ 'config', '--file', included, 'http.proxy', '' ], { timeoutMs: 10_000 });
    await git('config', 'include.path', included);

    const error = await assertSafeRepositoryConfig(runner, dir).catch(caught => caught);

    expect((error as UnsafeRepositoryConfigError).keys).toEqual([ 'include.path', 'http.proxy' ]);
  });

  it('refuses a worktree config', async () => {
    await git('config', 'extensions.worktreeConfig', 'true');
    await git('config', '--worktree', 'url.https://evil.example.com/.insteadOf', 'https://example.com/');

    const error = await assertSafeRepositoryConfig(runner, dir).catch(caught => caught);

    expect((error as UnsafeRepositoryConfigError).keys).toEqual([ 'url.https://evil.example.com/.insteadof' ]);
  });
});

describe('assertHelpersExecutable', () => {
  const helpers = join(__dirname, '../../helpers');
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fb-helpers-spec-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts the shipped helpers', () => {
    expect(() => assertHelpersExecutable(helpers)).not.toThrow();
  });

  it('refuses a missing helper', () => {
    copyFileSync(join(helpers, 'proxy-connect.cjs'), join(dir, 'proxy-connect.cjs'));
    chmodSync(join(dir, 'proxy-connect.cjs'), 0o755);

    expect(() => assertHelpersExecutable(dir)).toThrow(/askpass\.cjs/);
  });

  it('refuses a helper that is not executable', () => {
    for (const name of [ 'askpass.cjs', 'proxy-connect.cjs' ]) {
      copyFileSync(join(helpers, name), join(dir, name));
    }
    chmodSync(join(dir, 'askpass.cjs'), 0o755);
    chmodSync(join(dir, 'proxy-connect.cjs'), 0o644);

    expect(() => assertHelpersExecutable(dir)).toThrow(/proxy-connect\.cjs/);
  });
});
