import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitResult, GitRunner } from '../runner/git-runner';
import { GitOperationError } from './git-errors';
import { LocalGit } from './local-git';

const gitEnv = {
  PATH: process.env['PATH'] ?? '/usr/bin:/bin',
  HOME: tmpdir(),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.com'
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: gitEnv, stdio: 'pipe', encoding: 'utf8' });

// Runs git with the container's environment (POSIX PATH, /dev/null): not on Windows.
describe.skipIf(process.platform === 'win32')('LocalGit.currentBranch', () => {
  const local = new LocalGit(new GitRunner());
  let work: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'local-git-'));
    git(work, 'init', '-q', '-b', 'trunk');
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it('names the branch before its first commit', async () => {
    await expect(local.currentBranch(work)).resolves.toBe('trunk');
  });

  it('names a branch with slashes whole', async () => {
    git(work, 'commit', '-q', '--allow-empty', '-m', 'first');
    git(work, 'switch', '-q', '-c', 'feature/deep');

    await expect(local.currentBranch(work)).resolves.toBe('feature/deep');
  });

  it('follows a symbolic branch to the real one', async () => {
    git(work, 'commit', '-q', '--allow-empty', '-m', 'first');
    git(work, 'symbolic-ref', 'refs/heads/alias', 'refs/heads/trunk');
    git(work, 'symbolic-ref', 'HEAD', 'refs/heads/alias');

    await expect(local.currentBranch(work)).resolves.toBe('trunk');
  });

  it('has no branch on a detached HEAD', async () => {
    git(work, 'commit', '-q', '--allow-empty', '-m', 'first');
    git(work, 'checkout', '-q', '--detach');

    await expect(local.currentBranch(work)).resolves.toBeNull();
  });

  it('does not call an unreadable HEAD detached', async () => {
    writeFileSync(join(work, '.git', 'HEAD'), 'garbage\n');

    await expect(local.currentBranch(work)).rejects.toThrow('git symbolic-ref failed');
  });

  it('does not call a git that could not run detached', async () => {
    const failed: GitResult = { exitCode: null, stdout: '', stderr: 'spawn failed' } as GitResult;
    const broken = new LocalGit({ run: () => Promise.resolve(failed) } as unknown as GitRunner);

    await expect(broken.currentBranch(work)).rejects.toThrow('spawn failed');
  });

  it('reports a timeout as a timeout', async () => {
    const late = { exitCode: null, stdout: '', stderr: '', timedOut: true } as unknown as GitResult;
    const slow = new LocalGit({ run: () => Promise.resolve(late) } as unknown as GitRunner);

    await expect(slow.currentBranch(work)).rejects.toBeInstanceOf(GitOperationError);
  });

  describe('removeOwnLocks', () => {
    const lock = (name: string) => join(work, '.git', name);

    it('removes what a killed git can have left, with the current branch\'s lock and those it is told', async () => {
      const locks = [ 'index.lock', 'HEAD.lock', 'ORIG_HEAD.lock', 'refs/heads/trunk.lock', 'refs/heads/topic.lock' ];
      locks.forEach(name => writeFileSync(lock(name), ''));

      await new LocalGit(new GitRunner()).removeOwnLocks(work, [ 'refs/heads/topic' ]);

      expect(locks.filter(name => existsSync(lock(name)))).toEqual([]);
    });

    it('leaves what a push or a fetch may hold: the config, and a remote branch', async () => {
      mkdirSync(lock('refs/remotes/origin'), { recursive: true });
      const locks = [ 'config.lock', 'refs/remotes/origin/main.lock' ];
      locks.forEach(name => writeFileSync(lock(name), ''));

      await new LocalGit(new GitRunner()).removeOwnLocks(work);

      expect(locks.filter(name => existsSync(lock(name)))).toEqual(locks);
    });
  });
});
