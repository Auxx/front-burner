import type { Config } from '@front-burner/server-core-config';
import { Database, jobs, repositories, savedCredentials, syncState } from '@front-burner/server-core-database';
import type { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitRunner, NetworkLock, WorkingTreeLock } from '@front-burner/server-core-git';
import { JobRunner, RunningJob } from '@front-burner/server-core-jobs';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { DataLayout, newTrashName } from '@front-burner/server-core-storage';
import type { PushEvent, RemovalCheckResult } from '@front-burner/shared-contracts';
import { eq } from 'drizzle-orm';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CLONE_JOB_TYPE } from '../clone/clone-queue';
import { RepositoryQueries } from '../repositories/repository-queries';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createRemotes, git, testGitOptions } from '../testing/git-fixtures';
import { createTestDatabase } from '../testing/test-database';
import { DELETE_WORKING_COPY_JOB_TYPE, DeleteWorkingCopyJob } from '../working-copy/delete-working-copy.job';
import { RemovalCheck } from './removal-check';
import { RemoveRepositoryService } from './remove-repository.service';

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

const NOTHING: RemovalCheckResult = {
  uncommittedFiles: 0,
  unpushedCommits: 0,
  stashes: 0,
  mergeInProgress: false,
  unreadable: false
};

describe('RemoveRepositoryService', () => {
  let root: string;
  let remotes: { handbook: string; };
  let database: Database;
  let layout: DataLayout;
  let runner: JobRunner;
  let check: RemovalCheck;
  let publish: ReturnType<typeof vi.fn<(userId: number, event: PushEvent) => void>>;
  let service: RemoveRepositoryService;
  let lock: WorkingTreeLock;
  let networkLock: NetworkLock;
  let alice: number;
  let handbook: number;
  let work: string;

  const rowOf = (id: number) => database.db.select().from(repositories).where(eq(repositories.id, id)).get();
  const jobOf = (id: number) => database.db.select().from(jobs).where(eq(jobs.id, id)).get();
  const removeError = (promise: Promise<unknown>) =>
    promise.then(() => undefined, (error: unknown) => error as ApiErrorException);

  /** A clone of the fixture remote, as a ready repository's working copy. */
  function cloneInto(userId: number, repositoryId: number): string {
    const path = layout.workingCopy(userId, repositoryId);
    mkdirSync(dirname(path), { recursive: true });
    git(root, 'clone', '-q', remotes.handbook, path);
    return path;
  }

  /** A job type of the repository's own that runs until it is cancelled. */
  function registerWaiting(type: string, onAbort: () => void = () => undefined): RunningJob[] {
    const started: RunningJob[] = [];
    runner.register({
      type,
      pool: type === CLONE_JOB_TYPE ? 'clone' : 'fetch',
      onInterrupted: 'fail',
      handler: (job: RunningJob) => {
        started.push(job);
        return new Promise<void>((_, reject) => {
          job.signal.addEventListener('abort', () => {
            // Settles a little after its abort, as a git process that is killed does.
            setTimeout(() => {
              onAbort();
              reject(new Error('aborted'));
            }, 50);
          });
        });
      }
    });
    return started;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-remove-'));
    remotes = createRemotes(root);
    database = createTestDatabase();
    layout = new DataLayout(join(root, 'data'));
    mkdirSync(layout.tmpDir, { recursive: true });
    publish = vi.fn();
    const events = { publish } as unknown as EventsHub;
    runner = new JobRunner(database, { cloneConcurrency: 2 } as Config, events);
    const queries = new RepositoryQueries(database);
    check = new RemovalCheck(queries, new GitEngine(testGitOptions(), new GitRunner()), layout);
    lock = new WorkingTreeLock();
    networkLock = new NetworkLock();
    service = new RemoveRepositoryService(database, queries, check, runner, lock, networkLock, events, layout);
    new DeleteWorkingCopyJob(runner, layout).onModuleInit();
    alice = insertUser(database, 'alice@example.com');
    handbook = insertRepository(database, alice, { name: 'Handbook' });
    work = cloneInto(alice, handbook);
  });

  afterEach(async () => {
    await runner.beforeApplicationShutdown();
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('removes a clean repository without a name', async () => {
    await service.remove(alice, handbook, undefined);

    expect(rowOf(handbook)).toBeUndefined();
    expect(existsSync(work)).toBe(false);
  });

  it('refuses without the name when work would be lost', async () => {
    writeFileSync(join(work, 'a.md'), 'a\n');
    writeFileSync(join(work, 'b.md'), 'b\n');
    const fetch = registerWaiting('test.fetch');
    runner.start();
    runner.enqueue({ type: 'test.fetch', userId: alice, repositoryId: handbook, payload: {} });
    await waitFor(() => fetch.length === 1);

    for (const typed of [ undefined, 'handbook', 'Hand book' ]) {
      const error = await removeError(service.remove(alice, handbook, typed));
      expect(error).toBeInstanceOf(ApiErrorException);
      expect(error).toMatchObject({ code: 'removal-needs-confirmation', params: { ...NOTHING, uncommittedFiles: 2 } });
      expect(error?.getStatus()).toBe(409);
    }

    expect(rowOf(handbook)).toBeDefined();
    expect(existsSync(join(work, 'a.md'))).toBe(true);
    // Nothing changed: not even its jobs.
    expect(fetch[0]?.signal.aborted).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it('removes with the name when work would be lost', async () => {
    writeFileSync(join(work, 'a.md'), 'a\n');

    await service.remove(alice, handbook, '  Handbook ');

    expect(rowOf(handbook)).toBeUndefined();
    expect(existsSync(work)).toBe(false);
  });

  it('checks again inside the lock', async () => {
    // Clean when the dialog opened; a save holds the lock when the confirmation arrives.
    const of = vi.spyOn(check, 'of');
    let save!: () => void;
    const saving = lock.run(handbook, () =>
      new Promise<void>(done => {
        save = () => {
          writeFileSync(join(work, 'a.md'), 'a\n');
          done();
        };
      }));
    const removing = removeError(service.remove(alice, handbook, undefined));
    await new Promise(resolve => setTimeout(resolve, 20));
    save();
    await saving;

    const error = await removing;

    expect(of).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ code: 'removal-needs-confirmation', params: { ...NOTHING, uncommittedFiles: 1 } });
    expect(rowOf(handbook)).toBeDefined();
    expect(existsSync(join(work, 'a.md'))).toBe(true);
    expect(lock.isRemoved(handbook)).toBe(false);
  });

  it('marks the repository as removed for the work queued behind it', async () => {
    await service.remove(alice, handbook, undefined);

    expect(lock.isRemoved(handbook)).toBe(true);
  });

  it('waits for a running fetch to end before moving the working copy', async () => {
    let seen: boolean | undefined;
    // A fetch holds the network lock until its git has ended (A-5.3).
    runner.register({
      type: 'test.fetch',
      pool: 'fetch',
      onInterrupted: 'fail',
      handler: (job: RunningJob) =>
        networkLock.run(handbook, () =>
          new Promise<void>((_, reject) => {
            job.signal.addEventListener('abort', () =>
              setTimeout(() => {
                seen = existsSync(work);
                reject(new Error('aborted'));
              }, 50));
          }))
    });
    runner.start();
    runner.enqueue({ type: 'test.fetch', userId: alice, repositoryId: handbook, payload: {} });
    await waitFor(() => networkLock.size === 1);

    await service.remove(alice, handbook, undefined);

    // The working copy was still in place for as long as the fetch ran.
    expect(seen).toBe(true);
    expect(existsSync(work)).toBe(false);
  });

  // Mode bits do not make a folder unwritable on Windows, nor for root.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'changes nothing when the working copy cannot be moved',
    async () => {
      // The working copy cannot be renamed out of an unwritable folder.
      chmodSync(dirname(work), 0o500);
      try {
        await expect(service.remove(alice, handbook, undefined)).rejects.toMatchObject({ code: 'EACCES' });
      } finally {
        chmodSync(dirname(work), 0o755);
      }

      expect(rowOf(handbook)).toBeDefined();
      expect(existsSync(work)).toBe(true);
      expect(lock.isRemoved(handbook)).toBe(false);
      expect(publish).not.toHaveBeenCalled();
    }
  );

  it('puts the working copy back when the row cannot be deleted', async () => {
    vi.spyOn(database.db, 'delete').mockImplementation(() => {
      throw new Error('database is locked');
    });

    await expect(service.remove(alice, handbook, undefined)).rejects.toThrow('database is locked');

    expect(rowOf(handbook)).toBeDefined();
    expect(existsSync(join(work, '.git'))).toBe(true);
    expect(readdirSync(layout.tmpDir)).toEqual([]);
    expect(lock.isRemoved(handbook)).toBe(false);
  });

  // CloneJob's spec names AC-REPO-003.13 with a real clone; this one is about the order.
  it('waits for a cancelled clone to end before moving the working copy', async () => {
    const cloning = insertRepository(database, alice, { name: 'Notes', status: 'cloning' });
    const destination = layout.workingCopy(alice, cloning);
    // A clone that, once aborted, still renames a finished clone into place before it ends.
    const clones = registerWaiting(CLONE_JOB_TYPE, () => {
      mkdirSync(join(destination, '.git'), { recursive: true });
    });
    runner.start();
    const job = runner.enqueue({ type: CLONE_JOB_TYPE, userId: alice, repositoryId: cloning, payload: {} });
    await waitFor(() => clones.length === 1);

    await service.remove(alice, cloning, undefined);

    expect(clones[0]?.signal.aborted).toBe(true);
    expect(rowOf(cloning)).toBeUndefined();
    expect(jobOf(job)).toBeUndefined();
    // The clone ended before the folder was moved, so nothing is left behind.
    expect(existsSync(destination)).toBe(false);
    await waitFor(() => readdirSync(layout.tmpDir).length === 0);
  });

  it('cancels its fetch jobs', async () => {
    const fetch = registerWaiting('test.fetch');
    runner.start();
    runner.enqueue({ type: 'test.fetch', userId: alice, repositoryId: handbook, payload: {} });
    await waitFor(() => fetch.length === 1);
    const queued = runner.enqueue({
      type: 'test.fetch',
      userId: alice,
      repositoryId: handbook,
      payload: {},
      runAt: new Date(Date.now() + 60_000)
    });

    await service.remove(alice, handbook, undefined);

    expect(fetch[0]?.signal.aborted).toBe(true);
    expect(jobOf(queued)).toBeUndefined();
    expect(fetch).toHaveLength(1);
  });

  it('leaves other repositories and their jobs alone', async () => {
    const notes = insertRepository(database, alice, { name: 'Notes' });
    const notesWork = cloneInto(alice, notes);
    const fetch = registerWaiting('test.fetch');
    runner.start();
    runner.enqueue({ type: 'test.fetch', userId: alice, repositoryId: notes, payload: {} });
    await waitFor(() => fetch.length === 1);

    await service.remove(alice, handbook, undefined);

    expect(fetch[0]?.signal.aborted).toBe(false);
    expect(rowOf(notes)).toBeDefined();
    expect(existsSync(notesWork)).toBe(true);
  });

  it('deletes its rows', async () => {
    database.db.insert(syncState).values({ repositoryId: handbook, pushProblem: '{"code":"credentials-refused"}' })
      .run();

    await service.remove(alice, handbook, undefined);

    expect(rowOf(handbook)).toBeUndefined();
    expect(database.db.select().from(syncState).all()).toEqual([]);
  });

  it('deletes its working copy and trashed folders', async () => {
    const trashed = newTrashName(handbook);
    const othersTrash = newTrashName(handbook + 100);
    for (const name of [ trashed, othersTrash ]) {
      mkdirSync(join(layout.tmpDir, name, 'deep'), { recursive: true });
    }
    runner.start();

    await service.remove(alice, handbook, undefined);

    expect(existsSync(work)).toBe(false);
    // The move happens at once; the job deletes it from tmp/ in the background.
    await waitFor(() => readdirSync(layout.tmpDir).length === 1);
    expect(readdirSync(layout.tmpDir)).toEqual([ othersTrash ]);
    const [ deletion ] = database.db.select().from(jobs).where(eq(jobs.type, DELETE_WORKING_COPY_JOB_TYPE)).all();
    expect(deletion).toMatchObject({ userId: null, repositoryId: null, status: 'done' });
  });

  it('removes a repository whose working copy is gone', async () => {
    rmSync(work, { recursive: true });
    database.db.update(repositories).set({ status: 'error', errorCode: 'working-copy-missing' })
      .where(eq(repositories.id, handbook)).run();

    // Unreadable: nothing proves there is nothing to lose.
    await expect(removeError(service.remove(alice, handbook, undefined))).resolves.toMatchObject({
      code: 'removal-needs-confirmation'
    });
    await service.remove(alice, handbook, 'Handbook');

    expect(rowOf(handbook)).toBeUndefined();
  });

  it('removes a repository in error', async () => {
    const failed = insertRepository(database, alice, { name: 'Failed', status: 'error', errorCode: 'clone-failed' });

    await service.remove(alice, failed, undefined);

    expect(rowOf(failed)).toBeUndefined();
  });

  it('the name is free at once', async () => {
    await service.remove(alice, handbook, undefined);

    expect(() => insertRepository(database, alice, { name: 'handbook' })).not.toThrow();
  });

  it('keeps the saved credentials', async () => {
    const credentialId = database.db.insert(savedCredentials).values({
      userId: alice,
      kind: 'https',
      name: 'GitHub',
      username: 'alice',
      secret: 'encrypted',
      createdAt: new Date(0)
    }).returning().get().id;
    database.db.update(repositories).set({ credentialId }).where(eq(repositories.id, handbook)).run();

    await service.remove(alice, handbook, undefined);

    expect(database.db.select().from(savedCredentials).all()).toEqual([
      expect.objectContaining({ id: credentialId, name: 'GitHub' })
    ]);
  });

  it('publishes repository.removed', async () => {
    await service.remove(alice, handbook, undefined);

    expect(publish).toHaveBeenCalledWith(alice, { type: 'repository.removed', repositoryId: handbook });
  });

  it('answers another user\'s repository like a missing one', async () => {
    const bob = insertUser(database, 'bob@example.com');

    for (const [ userId, id ] of [ [ bob, handbook ], [ alice, handbook + 100 ] ] as const) {
      const error = await removeError(service.remove(userId, id, 'Handbook'));
      expect(error).toMatchObject({ code: 'not-found' });
      expect(error?.getStatus()).toBe(404);
    }
    expect(rowOf(handbook)).toBeDefined();
    expect(existsSync(work)).toBe(true);
  });
});
