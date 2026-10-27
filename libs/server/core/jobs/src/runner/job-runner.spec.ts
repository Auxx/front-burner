import type { Config } from '@front-burner/server-core-config';
import { Database, jobs, JobStatus, users } from '@front-burner/server-core-database';
import type { EventsHub } from '@front-burner/server-core-events';
import type { PushEvent } from '@front-burner/shared-contracts';
import { eq } from 'drizzle-orm';
import { createTestDatabase } from '../testing/test-database';
import { INTERRUPTED_ATTEMPT_LIMIT, JobRunner, SHUTDOWN_GRACE_MS, START_SPREAD_MS } from './job-runner';
import type { JobTypeDefinition, RunningJob } from './job-types';

const NOW = new Date('2026-10-27T12:00:00Z');

/** A promise the test settles. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('JobRunner', () => {
  let database: Database;
  let publish: ReturnType<typeof vi.fn<(userId: number, event: PushEvent) => void>>;
  let runner: JobRunner;
  let userId: number;

  const rowOf = (id: number) => database.db.select().from(jobs).where(eq(jobs.id, id)).get();
  /** Lets the loop and the handlers run. */
  const settle = () => vi.advanceTimersByTimeAsync(0);

  /** A clone-pool type whose jobs finish when the test says so. */
  function controlledType(overrides: Partial<JobTypeDefinition> = {}) {
    const started: { job: RunningJob<{ n?: number; }>; done: ReturnType<typeof deferred<unknown>>; }[] = [];
    runner.register<{ n?: number; }, unknown>({
      type: 'test.controlled',
      pool: 'clone',
      onInterrupted: 'fail',
      handler: job => {
        const done = deferred<unknown>();
        started.push({ job, done });
        job.signal.addEventListener(
          'abort',
          () => done.reject(Object.assign(new Error('aborted'), { code: 'aborted' }))
        );
        return done.promise;
      },
      ...overrides
    });
    return started;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ 'Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval' ] });
    vi.setSystemTime(NOW);
    database = createTestDatabase();
    userId = database.db.insert(users).values({
      email: 'alice@x.io',
      displayName: 'Alice',
      role: 'administrator',
      loginMethod: 'password',
      passwordHash: '$argon2id$hash',
      createdAt: NOW
    }).returning().get().id;
    publish = vi.fn();
    runner = new JobRunner(database, { cloneConcurrency: 2 } as Config, { publish } as unknown as EventsHub);
  });

  afterEach(async () => {
    const stopped = runner.beforeApplicationShutdown();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS);
    await stopped;
    database.sqlite.close();
    vi.useRealTimers();
  });

  it('runs a job and stores its result', async () => {
    runner.register({
      type: 'test.echo',
      pool: 'fetch',
      onInterrupted: 'fail',
      handler: (job: RunningJob<{ word: string; }>) => Promise.resolve({ echoed: job.payload.word })
    });
    runner.start();

    const id = runner.enqueue({ type: 'test.echo', payload: { word: 'hello' } });
    await settle();

    expect(rowOf(id)).toMatchObject({
      status: 'done',
      attempts: 1,
      result: JSON.stringify({ echoed: 'hello' }),
      finishedAt: NOW,
      errorCode: null
    });
  });

  it('runs at most the pool\'s size at once', async () => {
    const started = controlledType();
    runner.start();

    runner.enqueue({ type: 'test.controlled', payload: { n: 1 } });
    runner.enqueue({ type: 'test.controlled', payload: { n: 2 } });
    const third = runner.enqueue({ type: 'test.controlled', payload: { n: 3 } });
    await settle();

    expect(started.map(({ job }) => job.payload.n)).toEqual([ 1, 2 ]);
    expect(rowOf(third)?.status).toBe('queued');

    started[0]?.done.resolve(undefined);
    await settle();

    expect(started.map(({ job }) => job.payload.n)).toEqual([ 1, 2, 3 ]);
  });

  it('runs a job at its time', async () => {
    const started = controlledType();
    runner.start();

    runner.enqueue({ type: 'test.controlled', payload: {}, runAt: new Date(NOW.getTime() + 5000) });
    await vi.advanceTimersByTimeAsync(4000);
    expect(started).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    expect(started).toHaveLength(1);
  });

  it('returns the existing job for a duplicate', async () => {
    controlledType();

    const first = runner.enqueue({ type: 'test.controlled', payload: {}, dedupeKey: 'clone:1' });
    const second = runner.enqueue({ type: 'test.controlled', payload: {}, dedupeKey: 'clone:1' });

    expect(second).toBe(first);
    expect(database.db.select().from(jobs).all()).toHaveLength(1);
  });

  it('refuses more than the per-user limit', () => {
    controlledType({ perUserLimit: 3 });
    for (let i = 0; i < 3; i++) {
      runner.enqueue({ type: 'test.controlled', userId, payload: {} });
    }

    expect(() => runner.enqueue({ type: 'test.controlled', userId, payload: {} })).toThrow(
      expect.objectContaining({ code: 'too-many-jobs' })
    );
    // Jobs without a user have no limit.
    expect(() => runner.enqueue({ type: 'test.controlled', payload: {} })).not.toThrow();
  });

  it('records the error code of a failed job', async () => {
    runner.register({
      type: 'test.fail',
      pool: 'fetch',
      onInterrupted: 'fail',
      handler: ({ payload }: RunningJob<{ code: unknown; }>) => Promise.reject(Object.assign(new Error(), payload))
    });
    runner.start();

    const coded = runner.enqueue({ type: 'test.fail', payload: { code: 'clone-failed' } });
    const numbered = runner.enqueue({ type: 'test.fail', payload: { code: 42 } });
    await settle();

    expect(rowOf(coded)).toMatchObject({ status: 'failed', errorCode: 'clone-failed', finishedAt: NOW });
    expect(rowOf(numbered)).toMatchObject({ status: 'failed', errorCode: 'failed' });
  });

  it('retries with the delay while attempts remain', async () => {
    const attempts: number[] = [];
    runner.register({
      type: 'test.flaky',
      pool: 'email',
      onInterrupted: 'requeue',
      maxAttempts: 3,
      retryDelayMs: attempt => attempt * 10_000,
      handler: job => {
        attempts.push(job.attempt);
        return Promise.reject(new Error('down'));
      }
    });
    runner.start();

    const id = runner.enqueue({ type: 'test.flaky', payload: {} });
    await settle();
    expect(rowOf(id)).toMatchObject({ status: 'queued', attempts: 1, runAt: new Date(NOW.getTime() + 10_000) });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(rowOf(id)).toMatchObject({ status: 'queued', attempts: 2 });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(attempts).toEqual([ 1, 2, 3 ]);
    expect(rowOf(id)).toMatchObject({ status: 'failed', attempts: 3, errorCode: 'failed' });
  });

  it('publishes progress and the outcome to the job\'s user', async () => {
    const started = controlledType();
    runner.start();

    const id = runner.enqueue({ type: 'test.controlled', userId, payload: {} });
    await settle();
    const [ run ] = started;
    run?.job.reportProgress(10);
    run?.job.reportProgress(20);
    await vi.advanceTimersByTimeAsync(1000);
    run?.job.reportProgress(30.4);
    run?.done.resolve({ ok: true });
    await settle();

    expect(publish.mock.calls).toEqual([
      [ userId, { type: 'job.progress', jobId: id, percent: 10 } ],
      [ userId, { type: 'job.progress', jobId: id, percent: 30 } ],
      [ userId, { type: 'job.finished', jobId: id, outcome: 'done' } ]
    ]);
    expect(rowOf(id)?.progress).toBe(30);
  });

  it('cancels a queued job and aborts a running one', async () => {
    const started = controlledType({ maxAttempts: 3 });
    runner.start();

    const running = runner.enqueue({ type: 'test.controlled', userId, payload: {} });
    await settle();
    const queued = runner.enqueue({
      type: 'test.controlled',
      userId,
      payload: {},
      runAt: new Date(NOW.getTime() + 60_000)
    });

    runner.cancel({ userId, types: [ 'test.controlled' ] });
    await settle();

    expect(started[0]?.job.signal.aborted).toBe(true);
    expect(rowOf(running)).toMatchObject({ status: 'cancelled', attempts: 1 });
    expect(rowOf(queued)).toMatchObject({ status: 'cancelled', finishedAt: NOW });
    expect(publish).toHaveBeenCalledWith(userId, { type: 'job.finished', jobId: queued, outcome: 'cancelled' });
    expect(publish).toHaveBeenCalledWith(userId, { type: 'job.finished', jobId: running, outcome: 'cancelled' });
  });

  it('refuses to cancel without a filter', () => {
    controlledType();
    const id = runner.enqueue({ type: 'test.controlled', payload: {} });

    expect(() => runner.cancel({})).toThrow(/filter/);
    expect(rowOf(id)?.status).toBe('queued');
  });

  it('fails a job whose outcome could not be stored', async () => {
    runner.register({
      type: 'test.unstorable',
      pool: 'fetch',
      onInterrupted: 'fail',
      perUserLimit: 1,
      // JSON.stringify cannot store a bigint.
      handler: () => Promise.resolve({ size: BigInt(1) })
    });
    runner.start();

    const id = runner.enqueue({ type: 'test.unstorable', userId, payload: {} });
    await settle();

    expect(rowOf(id)).toMatchObject({ status: 'failed', errorCode: 'failed', finishedAt: NOW });
    expect(publish).toHaveBeenCalledWith(userId, { type: 'job.finished', jobId: id, outcome: 'failed' });
    // The user's slot is free again.
    expect(() => runner.enqueue({ type: 'test.unstorable', userId, payload: {} })).not.toThrow();
  });

  it('leaves other jobs alone when cancelling by ID', async () => {
    controlledType();
    const kept = runner.enqueue({ type: 'test.controlled', payload: {} });
    const cancelled = runner.enqueue({ type: 'test.controlled', payload: {} });

    runner.cancel({ id: cancelled });

    expect(rowOf(kept)?.status).toBe('queued');
    expect(rowOf(cancelled)?.status).toBe('cancelled');
  });

  it('shutdown aborts running jobs', async () => {
    const started = controlledType();
    runner.start();
    const id = runner.enqueue({ type: 'test.controlled', payload: {} });
    await settle();

    await runner.beforeApplicationShutdown();

    expect(started[0]?.job.signal.aborted).toBe(true);
    // Left for the next start to resolve by its type (A-6.8).
    expect(rowOf(id)?.status).toBe('running');
    runner.enqueue({ type: 'test.controlled', payload: {} });
    await settle();
    expect(started).toHaveLength(1);
  });

  it('shutdown waits at most 25 seconds', async () => {
    runner.register({
      type: 'test.stuck',
      pool: 'fetch',
      onInterrupted: 'fail',
      handler: () => new Promise(() => undefined)
    });
    runner.start();
    runner.enqueue({ type: 'test.stuck', payload: {} });
    await settle();

    let stopped = false;
    void runner.beforeApplicationShutdown().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS - 1);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(stopped).toBe(true);
  });

  it('refuses a payload with a secret-looking key', () => {
    controlledType();
    const payloads = [
      { password: 'x' },
      { auth: { token: 'x' } },
      { list: [ { clientSecret: 'x' } ] },
      { privateKey: 'x' },
      { key: { passphrase: 'x' } },
      { apiKey: 'x' }
    ];
    for (const payload of payloads) {
      expect(() => runner.enqueue({ type: 'test.controlled', payload })).toThrow(/secret/);
    }
    expect(database.db.select().from(jobs).all()).toEqual([]);
  });

  it('stores the payload as given', () => {
    controlledType();
    const id = runner.enqueue({ type: 'test.controlled', userId, payload: { repositoryId: 4, credentialsId: 2 } });
    expect(rowOf(id)).toMatchObject({ userId, payload: '{"repositoryId":4,"credentialsId":2}', status: 'queued' });
  });

  it('refuses an unknown type', () => {
    expect(() => runner.enqueue({ type: 'test.unknown', payload: {} })).toThrow(/Unknown job type/);
  });

  describe('on start', () => {
    /** A row as a stopped backend left it. */
    const leftover = (type: string, status: JobStatus, runAt = NOW) =>
      database.db.insert(jobs).values({
        type,
        userId,
        status,
        runAt,
        createdAt: NOW,
        attempts: status === 'running' ? 1 : 0
      })
        .returning().get().id;
    const register = (type: string, overrides: Partial<JobTypeDefinition> = {}) =>
      runner.register({
        type,
        pool: 'housekeeping',
        onInterrupted: 'requeue',
        handler: () => new Promise(() => undefined),
        ...overrides
      });

    it('fails an interrupted job whose type says so', async () => {
      const handler = vi.fn(() => Promise.resolve());
      register('test.clone', { pool: 'clone', onInterrupted: 'fail', handler });
      const id = leftover('test.clone', 'running');

      runner.start();
      await settle();

      expect(rowOf(id)).toMatchObject({ status: 'failed', errorCode: 'interrupted', finishedAt: NOW, attempts: 1 });
      expect(handler).not.toHaveBeenCalled();
      expect(publish).toHaveBeenCalledWith(userId, { type: 'job.finished', jobId: id, outcome: 'failed' });
    });

    it('requeues an interrupted job whose type says so', async () => {
      const handler = vi.fn(() => Promise.resolve());
      register('test.fetch', { pool: 'fetch', handler });
      const id = leftover('test.fetch', 'running');

      runner.start();
      await settle();

      expect(handler).toHaveBeenCalledOnce();
      expect(rowOf(id)).toMatchObject({ status: 'done', attempts: 2 });
    });

    it('fails an interrupted job that keeps being interrupted', () => {
      register('test.fetch', { pool: 'fetch' });
      const poison = leftover('test.fetch', 'running');
      database.db.update(jobs).set({ attempts: INTERRUPTED_ATTEMPT_LIMIT }).where(eq(jobs.id, poison)).run();
      const retried = leftover('test.fetch', 'running');
      database.db.update(jobs).set({ attempts: INTERRUPTED_ATTEMPT_LIMIT - 1 }).where(eq(jobs.id, retried)).run();

      runner.start();

      expect(rowOf(poison)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
      expect(rowOf(retried)?.status).not.toBe('failed');
    });

    it('fails a running job of an unknown type', () => {
      const id = leftover('test.removed', 'running');

      runner.start();

      expect(rowOf(id)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
    });

    it('spreads overdue housekeeping over two minutes', () => {
      register('test.housekeeping', { spreadOnStart: true });
      register('test.other');
      const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(
        0.999
      );
      const spread = [
        leftover('test.housekeeping', 'queued', new Date(NOW.getTime() - 3_600_000)),
        leftover(
          'test.housekeeping',
          'queued',
          new Date(NOW.getTime() - 1)
        ),
        leftover('test.housekeeping', 'running')
      ];
      const future = leftover('test.housekeeping', 'queued', new Date(NOW.getTime() + 600_000));
      const other = leftover('test.other', 'queued', new Date(NOW.getTime() - 1));

      runner.start();
      random.mockRestore();

      expect(spread.map(id => rowOf(id)?.runAt.getTime())).toEqual([
        NOW.getTime(),
        NOW.getTime() + START_SPREAD_MS / 2,
        NOW.getTime() + Math.floor(0.999 * START_SPREAD_MS)
      ]);
      expect(rowOf(future)?.runAt).toEqual(new Date(NOW.getTime() + 600_000));
      expect(rowOf(other)?.runAt).toEqual(new Date(NOW.getTime() - 1));
    });

    it('keeps one repeating job per type', async () => {
      const runs: number[] = [];
      register('test.repeat', {
        repeatEveryMs: 60_000,
        handler: job => {
          runs.push(job.id);
          return Promise.resolve();
        }
      });
      leftover('test.repeat', 'queued', new Date(NOW.getTime() + 30_000));
      database.db.update(jobs).set({ dedupeKey: 'repeat:test.repeat' }).run();

      runner.start();
      const unfinished = () =>
        database.db.select().from(jobs).all().filter(({ status }) => status === 'queued' || status === 'running');
      expect(unfinished()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(runs).toHaveLength(1);
      expect(unfinished()).toEqual([
        expect.objectContaining({ dedupeKey: 'repeat:test.repeat', runAt: new Date(NOW.getTime() + 90_000) })
      ]);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(runs).toHaveLength(2);
    });

    it('queues a missing repeating job', async () => {
      const handler = vi.fn(() => Promise.resolve());
      register('test.repeat', { repeatEveryMs: 60_000, handler });

      runner.start();
      await settle();

      expect(handler).toHaveBeenCalledOnce();
      expect(database.db.select().from(jobs).all().map(({ status }) => status)).toEqual([ 'done', 'queued' ]);
    });
  });
});
