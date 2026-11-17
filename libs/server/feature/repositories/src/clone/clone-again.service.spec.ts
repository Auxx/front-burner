import type { Config } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database, jobs, repositories, syncState } from '@front-burner/server-core-database';
import type { EventsHub } from '@front-burner/server-core-events';
import { CloneRequest, GitEngine, NetworkLock, WorkingTreeLock } from '@front-burner/server-core-git';
import { FIXTURE_PASSPHRASE, sshKeyFixture } from '@front-burner/server-core-git/testing';
import { JobPool, JobRunner } from '@front-burner/server-core-jobs';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { SessionLifecycle } from '@front-burner/server-core-security';
import { DataLayout, type DiskMonitor } from '@front-burner/server-core-storage';
import {
  JobKeys,
  KeyUnlockStore,
  KnownHostsService,
  SavedCredentialsService,
  UnlockAttempts
} from '@front-burner/server-feature-credentials';
import type { PushEvent } from '@front-burner/shared-contracts';
import { eq } from 'drizzle-orm';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestUser } from '../add/add-repository.service';
import { RepositoryQueries } from '../repositories/repository-queries';
import { insertRepository, insertUser } from '../testing/fixtures';
import { testGitOptions } from '../testing/git-fixtures';
import { createTestDatabase } from '../testing/test-database';
import { DeleteWorkingCopyJob } from '../working-copy/delete-working-copy.job';
import { CloneAgainService } from './clone-again.service';
import { CLONE_JOB_TYPE } from './clone-queue';
import { CloneJob } from './clone.job';

const box = new SecretBox('clone-again-spec-key-0123456789abcdef');
const SESSION = 'session-1';

/** Polls until `check` holds, for at most 10 seconds. */
async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting');
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const errorOf = (promise: Promise<unknown>) =>
  promise.then(() => undefined, (error: unknown) => error as ApiErrorException);

describe('CloneAgainService', () => {
  let root: string;
  let database: Database;
  let layout: DataLayout;
  let unlocks: KeyUnlockStore;
  let saved: SavedCredentialsService;
  let runner: JobRunner;
  let jobKeys: JobKeys;
  let publish: ReturnType<typeof vi.fn<(userId: number, event: PushEvent) => void>>;
  /** What the clone job asked git for; resolves at once unless a test holds it. */
  let clone: ReturnType<typeof vi.fn<(options: CloneRequest) => Promise<void>>>;
  let service: CloneAgainService;
  let lock: WorkingTreeLock;
  let alice: RequestUser;
  let handbook: number;
  /** Whether the disk monitor reports low space (NF-9.7). */
  let low: boolean;

  const rowOf = (id: number) => database.db.select().from(repositories).where(eq(repositories.id, id)).get();
  const statusOf = (id: number) => database.db.select().from(jobs).where(eq(jobs.id, id)).get()?.status;
  /** A job of the repository's own, of a type in `pool` that never runs here: the runner is not started. */
  const queueOther = (type: string, pool: JobPool) => {
    runner.register({ type, pool, onInterrupted: 'fail', handler: () => Promise.resolve() });
    return runner.enqueue({ type, userId: alice.id, repositoryId: handbook, payload: {} });
  };
  const cloneJobs = () => database.db.select().from(jobs).where(eq(jobs.type, CLONE_JOB_TYPE)).all();
  const workOf = (id: number) => layout.workingCopy(alice.id, id);
  const removedInTmp = () => readdirSync(layout.tmpDir).filter(name => name.startsWith('remove-'));

  /** A working copy left by the failed or damaged repository, with a file in it. */
  function leftOver(id: number): string {
    const work = workOf(id);
    mkdirSync(work, { recursive: true });
    writeFileSync(join(work, 'old.md'), 'old\n');
    return work;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-clone-again-'));
    database = createTestDatabase();
    layout = new DataLayout(join(root, 'data'));
    mkdirSync(layout.tmpDir, { recursive: true });
    publish = vi.fn();
    const events = { publish, publishToSession: vi.fn() } as unknown as EventsHub;
    unlocks = new KeyUnlockStore({ keyUnlockIdleMs: 3_600_000 } as Config, new SessionLifecycle(), events);
    saved = new SavedCredentialsService(database, box, unlocks, new UnlockAttempts());
    runner = new JobRunner(database, { cloneConcurrency: 2 } as Config, events);
    jobKeys = new JobKeys();
    clone = vi.fn(() => Promise.resolve());
    lock = new WorkingTreeLock();
    const engine = { clone } as unknown as GitEngine;
    new CloneJob(
      database,
      runner,
      engine,
      saved,
      new KnownHostsService(database, testGitOptions()),
      jobKeys,
      events,
      layout
    ).onModuleInit();
    new DeleteWorkingCopyJob(runner, layout).onModuleInit();
    service = new CloneAgainService(
      database,
      new RepositoryQueries(database),
      runner,
      saved,
      jobKeys,
      lock,
      new NetworkLock(),
      events,
      layout,
      { isLow: () => low } as DiskMonitor
    );
    low = false;
    alice = { id: insertUser(database, 'alice@example.com'), sessionId: SESSION, requestId: 'request-2' };
    handbook = insertRepository(database, alice.id, {
      name: 'Handbook',
      remoteUrl: 'https://git.example.com/acme/handbook.git',
      cloneMode: 'single-branch',
      branch: 'drafts',
      status: 'error',
      errorCode: 'clone-failed',
      errorDetail: 'fatal: unable to access',
      errorRequestId: 'request-1'
    });
  });

  afterEach(async () => {
    await runner.beforeApplicationShutdown();
    unlocks.onModuleDestroy();
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('retries a failed clone with the same settings', async () => {
    const summary = await service.cloneAgain(alice, handbook);

    expect(summary).toMatchObject({ id: handbook, name: 'Handbook', status: 'cloning', error: null, warnings: [] });
    expect(rowOf(handbook)).toMatchObject({
      status: 'cloning',
      errorCode: null,
      errorDetail: null,
      errorRequestId: null
    });
    const [ job ] = cloneJobs();
    // The new request's ID, for this clone's error record (RM-10).
    expect(JSON.parse(job?.payload ?? '')).toEqual({ repositoryId: handbook, requestId: 'request-2' });

    runner.start();
    await waitFor(() => rowOf(handbook)?.status === 'ready');
    expect(clone).toHaveBeenCalledWith(expect.objectContaining({
      remoteUrl: 'https://git.example.com/acme/handbook.git',
      mode: 'single-branch',
      branch: 'drafts',
      credentials: { kind: 'none' },
      destination: workOf(handbook)
    }));
  });

  it('Retry clone and Clone again on low space are refused', async () => {
    const work = leftOver(handbook);
    low = true;

    for (const errorCode of [ 'clone-failed', 'working-copy-missing' ] as const) {
      database.db.update(repositories).set({ errorCode }).where(eq(repositories.id, handbook)).run();
      const error = await errorOf(service.cloneAgain(alice, handbook));
      expect(error).toBeInstanceOf(ApiErrorException);
      expect(error).toMatchObject({ code: 'low-storage' });
      expect(error?.getStatus()).toBe(507);
    }

    // Nothing changed: the row, the working copy, the jobs, the events.
    expect(rowOf(handbook)).toMatchObject({ status: 'error', errorCode: 'working-copy-missing' });
    expect(readFileSync(join(work, 'old.md'), 'utf8')).toBe('old\n');
    expect(removedInTmp()).toEqual([]);
    expect(cloneJobs()).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  it('a repository not in error is answered as before on low space', async () => {
    low = true;
    database.db.update(repositories).set({ status: 'ready', errorCode: null }).where(eq(repositories.id, handbook))
      .run();

    expect((await errorOf(service.cloneAgain(alice, handbook)))?.getStatus()).toBe(409);
  });

  it('leaving low space allows clones again', async () => {
    low = true;
    expect((await errorOf(service.cloneAgain(alice, handbook)))?.getStatus()).toBe(507);

    low = false;
    await expect(service.cloneAgain(alice, handbook)).resolves.toMatchObject({ status: 'cloning' });
    expect(cloneJobs()).toHaveLength(1);
  });

  it('retries a timed out clone', async () => {
    database.db.update(repositories).set({ errorCode: 'clone-timed-out', errorDetail: null })
      .where(eq(repositories.id, handbook)).run();

    await expect(service.cloneAgain(alice, handbook)).resolves.toMatchObject({ status: 'cloning' });

    expect(cloneJobs()).toHaveLength(1);
  });

  it('uses the credentials changed since', async () => {
    const [ before, after ] = database.db.transaction(tx => [
      saved.createHttps(tx, alice.id, { name: 'Old', username: 'old', password: 'old-token' }),
      saved.createHttps(tx, alice.id, { name: 'New', username: 'new', password: 'new-token' })
    ]);
    database.db.update(repositories).set({ credentialId: before }).where(eq(repositories.id, handbook)).run();
    // Changed after the clone failed (RM-14), as the credentials section does.
    database.db.update(repositories).set({ credentialId: after }).where(eq(repositories.id, handbook)).run();

    await service.cloneAgain(alice, handbook);
    runner.start();
    await waitFor(() => rowOf(handbook)?.status === 'ready');

    expect(clone).toHaveBeenCalledWith(expect.objectContaining({
      credentials: { kind: 'https', username: 'new', password: 'new-token' }
    }));
    expect(rowOf(handbook)?.credentialId).toBe(after);
  });

  it('trashes the old working copy first', async () => {
    database.db.update(repositories).set({ errorCode: 'working-copy-missing' })
      .where(eq(repositories.id, handbook)).run();
    const work = leftOver(handbook);
    const existedAtClone: boolean[] = [];
    clone.mockImplementation(options => {
      existedAtClone.push(existsSync(options.destination));
      return Promise.resolve();
    });

    await service.cloneAgain(alice, handbook);

    // Moved out at once, before the clone can start.
    expect(existsSync(work)).toBe(false);
    runner.start();
    await waitFor(() => rowOf(handbook)?.status === 'ready');
    expect(existedAtClone).toEqual([ false ]);
    // Then deleted from tmp/ by the job of Remove repository.
    await waitFor(() => removedInTmp().length === 0);
  });

  it('keeps the name, override and last access time', async () => {
    const lastAccessedAt = new Date('2026-11-01T10:00:00.000Z');
    const createdAt = new Date('2026-10-01T10:00:00.000Z');
    database.db.update(repositories).set({
      errorCode: 'working-copy-missing',
      gitLevel: 'guided',
      commitAuthorName: 'Alice Work',
      commitAuthorEmail: 'alice@work.example.com',
      lastAccessedAt,
      createdAt
    }).where(eq(repositories.id, handbook)).run();
    leftOver(handbook);

    const summary = await service.cloneAgain(alice, handbook);

    expect(summary.lastAccessedAt).toBe(lastAccessedAt.toISOString());
    expect(rowOf(handbook)).toMatchObject({
      name: 'Handbook',
      gitLevel: 'guided',
      cloneMode: 'single-branch',
      branch: 'drafts',
      commitAuthorName: 'Alice Work',
      commitAuthorEmail: 'alice@work.example.com',
      lastAccessedAt,
      createdAt
    });
  });

  it('forgets the old sync state', async () => {
    database.db.update(repositories).set({ errorCode: 'working-copy-missing' })
      .where(eq(repositories.id, handbook)).run();
    database.db.insert(syncState).values({
      repositoryId: handbook,
      recordedCommit: 'a'.repeat(40),
      mergeCommit: 'b'.repeat(40),
      pushProblem: JSON.stringify({ code: 'credentials-refused', params: {} })
    }).run();

    await service.cloneAgain(alice, handbook);

    expect(database.db.select().from(syncState).where(eq(syncState.repositoryId, handbook)).get()).toBeUndefined();
  });

  it('a second retry is refused while cloning', async () => {
    let finish = () => undefined as void;
    clone.mockImplementation(() => new Promise<void>(resolve => (finish = resolve)));
    runner.start();

    const results = await Promise.allSettled([
      service.cloneAgain(alice, handbook),
      service.cloneAgain(alice, handbook)
    ]);

    expect(results.map(result => result.status).sort()).toEqual([ 'fulfilled', 'rejected' ]);
    const refused = results.find(result => result.status === 'rejected');
    expect(refused?.reason).toMatchObject({ code: 'repository-not-in-error', params: { status: 'cloning' } });
    expect((refused?.reason as ApiErrorException).getStatus()).toBe(409);
    // Also once the clone has started.
    await waitFor(() => clone.mock.calls.length === 1);
    expect(await errorOf(service.cloneAgain(alice, handbook))).toMatchObject({ code: 'repository-not-in-error' });
    expect(cloneJobs()).toHaveLength(1);
    finish();
    await waitFor(() => rowOf(handbook)?.status === 'ready');
  });

  it('refuses a ready repository', async () => {
    database.db.update(repositories).set({ status: 'ready', errorCode: null }).where(eq(repositories.id, handbook))
      .run();
    const work = leftOver(handbook);

    const error = await errorOf(service.cloneAgain(alice, handbook));

    expect(error).toMatchObject({ code: 'repository-not-in-error', params: { status: 'ready' } });
    expect(error?.getStatus()).toBe(409);
    expect(readFileSync(join(work, 'old.md'), 'utf8')).toBe('old\n');
    expect(cloneJobs()).toEqual([]);
    expect(publish).not.toHaveBeenCalled();
  });

  describe('with a passphrase-protected key', () => {
    let key: number;

    beforeEach(() => {
      key = database.db.transaction(tx =>
        saved.createPastedKey(tx, alice.id, {
          name: 'Laptop',
          privateKey: sshKeyFixture('ed25519-passphrase'),
          passphrase: FIXTURE_PASSPHRASE
        })
      );
      database.db.update(repositories)
        .set({
          remoteUrl: 'git@git.example.com:acme/handbook.git',
          credentialId: key,
          errorCode: 'working-copy-missing'
        })
        .where(eq(repositories.id, handbook))
        .run();
    });

    it('asks for the key when it is locked', async () => {
      const work = leftOver(handbook);

      const error = await errorOf(service.cloneAgain(alice, handbook));

      expect(error).toMatchObject({ code: 'key-locked', params: { keyId: key, keyName: 'Laptop' } });
      expect(error?.getStatus()).toBe(409);
      // Nothing changed: not even the old working copy.
      expect(rowOf(handbook)).toMatchObject({ status: 'error', errorCode: 'working-copy-missing' });
      expect(existsSync(join(work, 'old.md'))).toBe(true);
      expect(cloneJobs()).toEqual([]);
    });

    it('clones with the key unlocked in this session', async () => {
      saved.unlock(alice.id, SESSION, key, FIXTURE_PASSPHRASE);

      await service.cloneAgain(alice, handbook);
      runner.start();
      await waitFor(() => rowOf(handbook)?.status === 'ready');

      expect(clone).toHaveBeenCalledWith(expect.objectContaining({
        credentials: expect.objectContaining({ kind: 'ssh' })
      }));
    });
  });

  it('counts towards the clone limit', async () => {
    // Three clones of other repositories are waiting (NF-11.4).
    for (const name of [ 'One', 'Two', 'Three' ]) {
      const id = insertRepository(database, alice.id, { name, status: 'cloning' });
      runner.enqueue({ type: CLONE_JOB_TYPE, userId: alice.id, repositoryId: id, payload: { repositoryId: id } });
    }
    database.db.update(repositories).set({ errorCode: 'working-copy-missing' })
      .where(eq(repositories.id, handbook)).run();
    const work = leftOver(handbook);
    const fetch = queueOther('test.fetch', 'fetch');

    const error = await errorOf(service.cloneAgain(alice, handbook));

    expect(error).toMatchObject({ code: 'too-many-jobs' });
    expect(error?.getStatus()).toBe(429);
    // As it was: the working copy is put back, and no job was cancelled.
    expect(rowOf(handbook)).toMatchObject({ status: 'error', errorCode: 'working-copy-missing' });
    expect(readFileSync(join(work, 'old.md'), 'utf8')).toBe('old\n');
    expect(removedInTmp()).toEqual([]);
    expect(statusOf(fetch)).toBe('queued');
    expect(lock.generation(handbook)).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes repository.status', async () => {
    await service.cloneAgain(alice, handbook);

    expect(publish).toHaveBeenCalledWith(alice.id, {
      type: 'repository.status',
      repositoryId: handbook,
      status: 'cloning',
      error: null
    });
  });

  it('publishes cloning before a clone that fails at once ends', async () => {
    clone.mockRejectedValue(new Error('refused'));
    runner.start();

    await service.cloneAgain(alice, handbook);
    await waitFor(() => rowOf(handbook)?.status === 'error');

    const statuses = publish.mock.calls.map(([ , event ]) => event)
      .filter(event => event.type === 'repository.status')
      .map(event => 'status' in event ? event.status : undefined);
    expect(statuses).toEqual([ 'cloning', 'error' ]);
  });

  it('cancels the repository\'s fetches, pulls and pushes, not its Delete folder jobs', async () => {
    const fetch = queueOther('test.fetch', 'fetch');
    const deleteFolder = queueOther('test.delete-folder', 'housekeeping');

    await service.cloneAgain(alice, handbook);

    expect(statusOf(fetch)).toBe('cancelled');
    expect(statusOf(deleteFolder)).toBe('queued');
    expect(cloneJobs().map(job => job.status)).toEqual([ 'queued' ]);
  });

  it('tells the work queued for the old working copy to refuse', async () => {
    const before = lock.generation(handbook);

    await service.cloneAgain(alice, handbook);

    expect(lock.generation(handbook)).not.toBe(before);
  });

  it('refuses while an earlier clone is unfinished, whatever the status says', async () => {
    runner.enqueue({
      type: CLONE_JOB_TYPE,
      userId: alice.id,
      repositoryId: handbook,
      payload: { repositoryId: handbook },
      dedupeKey: `clone:${handbook}`
    });

    const error = await errorOf(service.cloneAgain(alice, handbook));

    expect(error).toMatchObject({ code: 'repository-not-in-error', params: { status: 'cloning' } });
    expect(rowOf(handbook)?.status).toBe('error');
    expect(cloneJobs()).toHaveLength(1);
  });

  it('answers another user\'s repository like a missing one', async () => {
    const bob = insertUser(database, 'bob@example.com');
    const secret = insertRepository(database, bob, { name: 'secret', status: 'error', errorCode: 'clone-failed' });

    const other = await errorOf(service.cloneAgain(alice, secret));
    const none = await errorOf(service.cloneAgain(alice, secret + 100));

    expect(other).toMatchObject({ code: 'not-found' });
    expect(other?.getStatus()).toBe(404);
    expect(none).toMatchObject({ code: 'not-found' });
    expect(rowOf(secret)).toMatchObject({ status: 'error', errorCode: 'clone-failed' });
    expect(cloneJobs()).toEqual([]);
  });
});
