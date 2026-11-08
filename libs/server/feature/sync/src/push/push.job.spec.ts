import { repositories } from '@front-burner/server-core-database';
import { unlockPrivateKey } from '@front-burner/server-core-git';
import { sshKeyFixture } from '@front-burner/server-core-git/testing';
import { eq } from 'drizzle-orm';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, refuseWithHook, trustTestCertificate } from '../testing/git-fixtures';
import { PushHarness } from '../testing/push-harness';
import { PUSH_JOB_TYPE } from './push.job';

// The broker listens on a Unix socket in a POSIX path: not on Windows.
describe.skipIf(process.platform === 'win32')('PushJob', () => {
  let restoreCa: () => void;
  let harness: PushHarness;

  const enqueue = () =>
    harness.runner.enqueue({
      type: PUSH_JOB_TYPE,
      userId: harness.alice,
      repositoryId: harness.repositoryId,
      payload: { branch: 'main' },
      dedupeKey: `push:${harness.repositoryId}:main`
    });
  const resultOf = (id: number) => JSON.parse(harness.jobOf(id)?.result ?? 'null') as unknown;
  const gitChanged = () =>
    harness.published.filter(({ event }) =>
      event.type === 'git.changed' && event.repositoryId === harness.repositoryId
    );

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

  it('drops the key copy on done, failed and cancelled', async () => {
    const key = unlockPrivateKey(sshKeyFixture('ed25519'));
    harness.runner.start();

    harness.commit('second');
    const done = enqueue();
    harness.jobKeys.hold(done, 1, key);
    await harness.finished(done);
    expect(harness.jobOf(done)?.status).toBe('done');
    expect(harness.jobKeys.take(done, 1)).toBeUndefined();

    // A repository whose working copy is gone fails the job.
    await harness.runner.beforeApplicationShutdown();
    harness.build();
    harness.commit('third');
    const failed = enqueue();
    harness.jobKeys.hold(failed, 1, key);
    harness.database.db.update(repositories).set({ status: 'error' }).where(eq(repositories.id, harness.repositoryId))
      .run();
    harness.runner.start();
    await harness.finished(failed);
    expect(harness.jobOf(failed)?.status).toBe('failed');
    expect(harness.jobKeys.take(failed, 1)).toBeUndefined();

    await harness.runner.beforeApplicationShutdown();
    harness.build();
    const cancelled = enqueue();
    harness.jobKeys.hold(cancelled, 1, key);
    harness.runner.cancel({ id: cancelled });
    expect(harness.jobOf(cancelled)?.status).toBe('cancelled');
    expect(harness.jobKeys.take(cancelled, 1)).toBeUndefined();
  });

  it('returns a push the remote refused as a finished job, with the remote\'s lines', async () => {
    refuseWithHook(harness.bare, 'echo "Pushes are frozen until Monday." >&2');
    harness.commit('second');
    harness.runner.start();

    const id = enqueue();
    await harness.finished(id);

    expect(harness.jobOf(id)?.status).toBe('done');
    expect(resultOf(id)).toEqual({
      kind: 'failed',
      code: 'push-rejected',
      params: expect.objectContaining({ branch: 'main', remoteMessages: 'Pushes are frozen until Monday.' })
    });
    expect(harness.remoteLog()).toBe('first');
  });

  it('a push rejected as non-fast-forward fetches, and shows what to pull', async () => {
    harness.pushFromElsewhere('theirs');
    harness.commit('mine');
    harness.runner.start();

    const id = enqueue();
    await harness.finished(id);

    expect(resultOf(id)).toMatchObject({ kind: 'failed', code: 'push-non-fast-forward' });
    expect(git(harness.workingCopy, 'log', '-1', '--format=%s', 'origin/main').trim()).toBe('theirs');
    expect(await harness.engine.status(harness.workingCopy)).toMatchObject({ ahead: 1, behind: 1 });
  });

  it('a push queued before a merge started does not run during it', async () => {
    harness.commit('second');
    const id = enqueue();
    // A pull's merge that conflicted, after the push was queued.
    const head = git(harness.workingCopy, 'rev-parse', 'HEAD').trim();
    writeFileSync(join(harness.workingCopy, '.git', 'MERGE_HEAD'), `${head}\n`);
    harness.runner.start();
    await harness.finished(id);

    expect(harness.jobOf(id)?.status).toBe('done');
    expect(resultOf(id)).toEqual({ kind: 'failed', code: 'merge-in-progress', params: { branch: 'main' } });
    expect(harness.remoteLog()).toBe('first');
  });

  it('publishes git.changed when it ends', async () => {
    harness.commit('second');
    harness.runner.start();

    const pushed = enqueue();
    await harness.finished(pushed);
    expect(gitChanged()).toHaveLength(1);

    refuseWithHook(harness.bare, 'echo no >&2');
    harness.commit('third');
    const refused = enqueue();
    await harness.finished(refused);
    expect(gitChanged()).toHaveLength(2);
    expect(gitChanged().every(({ userId }) => userId === harness.alice)).toBe(true);
  });
});
