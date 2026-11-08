import { unlockPrivateKey } from '@front-burner/server-core-git';
import { sshKeyFixture } from '@front-burner/server-core-git/testing';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, trustTestCertificate } from '../testing/git-fixtures';
import { PushHarness } from '../testing/push-harness';
import { FETCH_JOB_TYPE, fetchDedupeKey } from './fetch.job';

// The broker listens on a Unix socket in a POSIX path: not on Windows.
describe.skipIf(process.platform === 'win32')('FetchJob', () => {
  let restoreCa: () => void;
  let harness: PushHarness;

  const enqueue = () =>
    harness.runner.enqueue({
      type: FETCH_JOB_TYPE,
      userId: harness.alice,
      repositoryId: harness.repositoryId,
      payload: {},
      dedupeKey: fetchDedupeKey(harness.repositoryId)
    });
  const resultOf = (id: number) => JSON.parse(harness.jobOf(id)?.result ?? 'null') as unknown;

  beforeAll(() => {
    restoreCa = trustTestCertificate();
  });

  afterAll(() => {
    restoreCa();
  });

  beforeEach(async () => {
    harness = await PushHarness.start();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('fetches without credentials', async () => {
    harness.pushFromElsewhere('theirs');
    harness.runner.start();

    const id = enqueue();
    await harness.finished(id);

    expect(harness.jobOf(id)?.status).toBe('done');
    expect(resultOf(id)).toEqual({ kind: 'fetched', moved: true });
    expect(git(harness.workingCopy, 'log', '-1', '--format=%s', 'origin/main').trim()).toBe('theirs');
    // Remote branches only: the user's branch stays (GA-33).
    expect(git(harness.workingCopy, 'log', '-1', '--format=%s', 'main').trim()).toBe('first');
  });

  it('returns a refused fetch as a finished job with its code', async () => {
    harness.useRemote('https://127.0.0.1:1/handbook.git');
    harness.runner.start();

    const id = enqueue();
    await harness.finished(id);

    expect(harness.jobOf(id)?.status).toBe('done');
    expect(resultOf(id)).toEqual({ kind: 'failed', code: 'host-unreachable', params: { host: '127.0.0.1' } });
  });

  it('fetches during a merge, which stays', async () => {
    const workingCopy = harness.workingCopy;
    writeFileSync(join(workingCopy, 'notes.md'), 'base\n');
    git(workingCopy, 'add', 'notes.md');
    git(workingCopy, 'commit', '-q', '-m', 'base');
    git(workingCopy, 'checkout', '-q', '-b', 'other');
    writeFileSync(join(workingCopy, 'notes.md'), 'theirs\n');
    git(workingCopy, 'commit', '-q', '-am', 'theirs');
    git(workingCopy, 'checkout', '-q', 'main');
    writeFileSync(join(workingCopy, 'notes.md'), 'mine\n');
    git(workingCopy, 'commit', '-q', '-am', 'mine');
    expect(() => git(workingCopy, 'merge', '-q', 'other')).toThrow();
    const mergeHead = readFileSync(join(workingCopy, '.git', 'MERGE_HEAD'), 'utf8');
    const conflicted = readFileSync(join(workingCopy, 'notes.md'), 'utf8');
    harness.pushFromElsewhere('remote work');
    harness.runner.start();

    const id = enqueue();
    await harness.finished(id);

    expect(resultOf(id)).toEqual({ kind: 'fetched', moved: true });
    expect(existsSync(join(workingCopy, '.git', 'MERGE_HEAD'))).toBe(true);
    expect(readFileSync(join(workingCopy, '.git', 'MERGE_HEAD'), 'utf8')).toBe(mergeHead);
    expect(readFileSync(join(workingCopy, 'notes.md'), 'utf8')).toBe(conflicted);
    expect(git(workingCopy, 'ls-files', '-u').trim()).not.toBe('');
  });

  it('drops the key copy when it ends, and leaves git.changed to the step', async () => {
    const key = unlockPrivateKey(sshKeyFixture('ed25519'));
    harness.runner.start();

    const id = enqueue();
    harness.jobKeys.hold(id, 1, key);
    await harness.finished(id);

    expect(harness.jobKeys.take(id, 1)).toBeUndefined();
    // Nothing moved and no problem changed.
    expect(harness.published.filter(({ event }) => event.type === 'git.changed')).toEqual([]);
  });
});
