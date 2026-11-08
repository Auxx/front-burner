import { jobs, repositories } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { eq } from 'drizzle-orm';
import { PUSH_JOB_TYPE } from '../push/push.job';
import { insertRepository } from '../testing/fixtures';
import { trustTestCertificate } from '../testing/git-fixtures';
import { PushHarness } from '../testing/push-harness';

const SESSION = 'session-1';

// The broker listens on a Unix socket in a POSIX path: not on Windows.
describe.skipIf(process.platform === 'win32')('GitJobs', () => {
  let restoreCa: () => void;
  let harness: PushHarness;

  const startPush = (id = harness.repositoryId) =>
    harness.service.start({ userId: harness.alice, sessionId: SESSION }, id);
  const state = (jobId: number, id = harness.repositoryId, userId = harness.alice) =>
    harness.gitJobs.state(userId, id, jobId);

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

  it('reports the pushed commits and upstream', async () => {
    harness.commit('second');
    harness.commit('third');
    harness.runner.start();

    const jobId = await startPush();
    await harness.finished(jobId);

    expect(state(jobId)).toEqual({
      status: 'done',
      outcome: { kind: 'pushed', commits: 2, upstream: 'origin/main' }
    });
    expect(harness.remoteLog()).toBe('third\nsecond\nfirst');
  });

  it('reports no-credentials for a repository without any', async () => {
    await harness.serve({ users: { alice: 'token' } });
    harness.commit('second');
    harness.runner.start();

    const jobId = await startPush();
    await harness.finished(jobId);

    expect(state(jobId)).toEqual({
      status: 'done',
      outcome: { kind: 'failed', code: 'no-credentials', params: expect.objectContaining({ branch: 'main' }) }
    });
  });

  it('reports refused credentials and the remote\'s lines', async () => {
    const credentialId = harness.database.db.transaction(tx =>
      harness.saved.createHttps(tx, harness.alice, { name: 'Work', username: 'alice', password: 'wrong' })
    );
    await harness.serve({ users: { alice: 'token' } });
    harness.database.db.update(repositories).set({ credentialId }).where(eq(repositories.id, harness.repositoryId))
      .run();
    harness.commit('second');
    harness.runner.start();

    const jobId = await startPush();
    await harness.finished(jobId);

    expect(state(jobId)).toMatchObject({
      status: 'done',
      outcome: { kind: 'failed', code: 'credentials-refused' }
    });
  });

  it('reports an interrupted push', async () => {
    const jobId = harness.database.db.insert(jobs).values({
      type: PUSH_JOB_TYPE,
      userId: harness.alice,
      repositoryId: harness.repositoryId,
      payload: JSON.stringify({ branch: 'main' }),
      status: 'running',
      runAt: new Date(),
      createdAt: new Date(),
      attempts: 1,
      dedupeKey: `push:${harness.repositoryId}:main`
    }).returning().get().id;

    // As after a restart.
    await harness.runner.beforeApplicationShutdown();
    harness.build();
    harness.runner.start();

    expect(state(jobId)).toEqual({
      status: 'failed',
      outcome: { kind: 'failed', code: 'interrupted', params: {} }
    });
  });

  it('answers another user\'s job like a missing one', async () => {
    harness.commit('second');
    const jobId = await startPush();
    const other = insertRepository(harness.database, harness.alice, { name: 'Other' });

    expect(() => state(jobId, other)).toThrow(new ApiErrorException(404, 'not-found'));
    expect(() => state(jobId + 100)).toThrow(new ApiErrorException(404, 'not-found'));
    expect(() => state(jobId, harness.repositoryId, harness.bob)).toThrow(new ApiErrorException(404, 'not-found'));
  });

  it('answers a clone job like a missing one', () => {
    const jobId = harness.database.db.insert(jobs).values({
      type: 'repositories.clone',
      userId: harness.alice,
      repositoryId: harness.repositoryId,
      payload: '{}',
      status: 'queued',
      runAt: new Date(),
      createdAt: new Date(),
      attempts: 0
    }).returning().get().id;

    expect(() => state(jobId)).toThrow(new ApiErrorException(404, 'not-found'));
    expect(harness.gitJobs.networkJob(harness.alice, harness.repositoryId)).toBeNull();
  });

  it('reports the running job as the network job', async () => {
    harness.commit('second');
    expect(harness.gitJobs.networkJob(harness.alice, harness.repositoryId)).toBeNull();

    const jobId = await startPush();

    expect(harness.gitJobs.networkJob(harness.alice, harness.repositoryId)).toEqual({ id: jobId, type: 'push' });
    expect(harness.gitJobs.networkJob(harness.bob, harness.repositoryId)).toBeNull();
    expect(state(jobId)).toEqual({ status: 'queued', outcome: null });
  });
});
