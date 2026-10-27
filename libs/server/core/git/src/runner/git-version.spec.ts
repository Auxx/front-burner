import type { GitResult, GitRunner } from './git-runner';
import { assertSupportedGit, gitVersion } from './git-version';

const runnerAnswering = (result: Partial<GitResult>) =>
  ({
    run: async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, ...result })
  }) as unknown as GitRunner;

describe('gitVersion', () => {
  it('reads the version of git', async () => {
    expect(await gitVersion(runnerAnswering({ stdout: 'git version 2.56.0\n' }))).toEqual([ 2, 56, 0 ]);
  });

  it('refuses git older than 2.47', async () => {
    await expect(assertSupportedGit(runnerAnswering({ stdout: 'git version 2.46.1\n' }))).rejects.toThrow(
      /2\.46\.1.*2\.47\.0/
    );
    await expect(assertSupportedGit(runnerAnswering({ stdout: 'git version 2.56.0\n' }))).resolves.toBeUndefined();
    await expect(assertSupportedGit(runnerAnswering({ stdout: 'git version 2.47.0.windows.1\n' }))).resolves
      .toBeUndefined();
    await expect(assertSupportedGit(runnerAnswering({ stdout: 'git version 3.0.0\n' }))).resolves.toBeUndefined();
  });

  it('refuses a missing git', async () => {
    await expect(assertSupportedGit(runnerAnswering({ exitCode: null, stderr: 'spawn git ENOENT' }))).rejects
      .toThrow(/git is not installed/);
  });

  it('runs the real git', async () => {
    const { GitRunner: Runner } = await import('./git-runner');

    await expect(assertSupportedGit(new Runner())).resolves.toBeUndefined();
  });
});
