import { CONFIG, Config } from '@front-burner/server-core-config';
import { DATABASE, Database, Job, jobs } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { and, asc, count, eq, inArray, lte, SQL, sql } from 'drizzle-orm';
import { CancelFilter, EnqueueRequest, JobPool, jobPoolSizes, JobTypeDefinition, RunningJob } from './job-types';

/** How often the loop looks for scheduled jobs when nothing woke it (A-6.4). */
export const TICK_MS = 1000;
/** How long shutdown waits for aborted jobs to settle (A-1.14). */
export const SHUTDOWN_GRACE_MS = 25_000;
/** Overdue jobs of `spreadOnStart` types run within this time after a start (A-6.8). */
export const START_SPREAD_MS = 120_000;
const PROGRESS_INTERVAL_MS = 1000;
const UNFINISHED = [ 'queued', 'running' ] as const;

/** Keys that suggest a secret: none may reach the table (A-6.3). */
const SECRET_KEY = /password|token|secret|private_?key|passphrase/i;

interface ActiveJob {
  job: Job;
  pool: JobPool;
  controller: AbortController;
  cancelled: boolean;
  settled: Promise<void>;
}

/**
 * Runs background jobs stored in the `jobs` table (A-6.1 to A-6.6). One loop
 * claims due jobs atomically for each pool with a free slot; enqueuing wakes
 * it, and a one-second tick finds scheduled ones.
 */
@Injectable()
export class JobRunner implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(JobRunner.name);
  private readonly types = new Map<string, JobTypeDefinition>();
  private readonly active = new Map<number, ActiveJob>();
  private readonly poolSizes: Record<JobPool, number>;
  private tick: ReturnType<typeof setInterval> | undefined;
  private wakePending = false;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CONFIG) config: Pick<Config, 'cloneConcurrency'>,
    private readonly events: EventsHub
  ) {
    this.poolSizes = jobPoolSizes(config);
  }

  register<P, R>(definition: JobTypeDefinition<P, R>): void {
    if (this.types.has(definition.type)) {
      throw new Error(`Job type ${definition.type} is already registered`);
    }
    this.types.set(definition.type, definition as JobTypeDefinition);
  }

  onApplicationBootstrap(): void {
    this.start();
  }

  /**
   * Resolves the jobs a stopped backend left running, spreads overdue ones,
   * queues the repeating types, then starts the loop (A-6.8). Runs after every
   * feature registered its types.
   */
  start(): void {
    if (this.running) {
      return;
    }
    this.resolveInterrupted();
    this.spreadOverdue();
    for (const definition of this.types.values()) {
      if (definition.repeatEveryMs !== undefined) {
        this.enqueue({
          type: definition.type,
          payload: {},
          dedupeKey: repeatKeyOf(definition.type),
          runAt: definition.spreadOnStart ? spreadTime() : new Date()
        });
      }
    }
    this.running = true;
    this.tick = setInterval(() => this.wake(), TICK_MS);
    this.tick.unref();
    this.wake();
  }

  /**
   * Queues a job and returns its ID; for a dedupe key that an unfinished job
   * already has, that job's ID.
   * @throws ApiErrorException `too-many-jobs` (429) at the type's per-user limit.
   */
  enqueue(request: EnqueueRequest): number {
    const definition = this.definitionOf(request.type);
    assertNoSecret(request.payload, 'payload');
    if (request.dedupeKey !== undefined) {
      const existing = this.unfinishedWithKey(request.dedupeKey);
      if (existing !== undefined) {
        return existing;
      }
    }
    if (definition.perUserLimit !== undefined && request.userId !== undefined) {
      const [ { waiting } ] = this.database.db.select({ waiting: count() }).from(jobs).where(and(
        eq(jobs.type, request.type),
        eq(jobs.userId, request.userId),
        inArray(jobs.status, UNFINISHED)
      )).all();
      if (waiting >= definition.perUserLimit) {
        throw new ApiErrorException(429, 'too-many-jobs');
      }
    }
    const now = new Date();
    let id: number;
    try {
      id = this.database.db.insert(jobs).values({
        type: request.type,
        userId: request.userId ?? null,
        payload: JSON.stringify(request.payload),
        status: 'queued',
        runAt: request.runAt ?? now,
        createdAt: now,
        dedupeKey: request.dedupeKey ?? null
      }).returning({ id: jobs.id }).get().id;
    } catch (error) {
      const existing = request.dedupeKey === undefined ? undefined : this.unfinishedWithKey(request.dedupeKey);
      if (existing === undefined) {
        throw error;
      }
      return existing;
    }
    this.wake();
    return id;
  }

  /** Queued jobs become `cancelled`; running ones get their signal aborted. */
  cancel(where: CancelFilter): void {
    const conditions: SQL[] = [];
    if (where.id !== undefined) {
      conditions.push(eq(jobs.id, where.id));
    }
    if (where.userId !== undefined) {
      conditions.push(eq(jobs.userId, where.userId));
    }
    if (where.types !== undefined) {
      conditions.push(inArray(jobs.type, where.types));
    }
    const cancelled = this.database.db.update(jobs)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(and(eq(jobs.status, 'queued'), ...conditions))
      .returning()
      .all();
    for (const job of cancelled) {
      this.publishFinished(job, 'cancelled');
    }
    for (const active of this.active.values()) {
      const { job } = active;
      if (
        (where.id === undefined || job.id === where.id)
        && (where.userId === undefined || job.userId === where.userId)
        && (where.types === undefined || where.types.includes(job.type))
      ) {
        active.cancelled = true;
        active.controller.abort();
      }
    }
  }

  /** Stops claiming, aborts running jobs and waits for them a while (A-1.14). */
  async beforeApplicationShutdown(): Promise<void> {
    this.running = false;
    clearInterval(this.tick);
    const settled = [ ...this.active.values() ].map(active => {
      active.controller.abort();
      return active.settled;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(settled),
      new Promise<void>(done => {
        timer = setTimeout(done, SHUTDOWN_GRACE_MS);
      })
    ]);
    clearTimeout(timer);
  }

  /** NF-9.5: by the type's rule; a job of a type no feature registers any more fails. */
  private resolveInterrupted(): void {
    const interrupted = this.database.db.select().from(jobs).where(eq(jobs.status, 'running')).all();
    for (const job of interrupted) {
      if (this.types.get(job.type)?.onInterrupted === 'requeue') {
        this.database.db.update(jobs).set({ status: 'queued' }).where(eq(jobs.id, job.id)).run();
        this.logger.log({ jobId: job.id, type: job.type }, 'An interrupted job is queued again');
      } else {
        this.database.db.update(jobs)
          .set({ status: 'failed', errorCode: 'interrupted', finishedAt: new Date() })
          .where(eq(jobs.id, job.id))
          .run();
        this.publishFinished(job, 'failed');
        this.logger.warn({ jobId: job.id, type: job.type }, 'An interrupted job failed');
      }
    }
  }

  private spreadOverdue(): void {
    const types = [ ...this.types.values() ].filter(({ spreadOnStart }) => spreadOnStart).map(({ type }) => type);
    if (types.length === 0) {
      return;
    }
    const overdue = this.database.db.select({ id: jobs.id }).from(jobs)
      .where(and(eq(jobs.status, 'queued'), inArray(jobs.type, types), lte(jobs.runAt, new Date())))
      .all();
    for (const { id } of overdue) {
      this.database.db.update(jobs).set({ runAt: spreadTime() }).where(eq(jobs.id, id)).run();
    }
  }

  private wake(): void {
    if (this.wakePending || !this.running) {
      return;
    }
    this.wakePending = true;
    queueMicrotask(() => {
      this.wakePending = false;
      this.claimDueJobs();
    });
  }

  private claimDueJobs(): void {
    for (const pool of Object.keys(this.poolSizes) as JobPool[]) {
      const types = [ ...this.types.values() ].filter(definition => definition.pool === pool).map(({ type }) => type);
      while (this.running && types.length > 0 && this.activeIn(pool) < this.poolSizes[pool]) {
        const job = this.claim(types);
        if (job === undefined) {
          break;
        }
        this.run(job, pool);
      }
    }
  }

  private activeIn(pool: JobPool): number {
    let active = 0;
    for (const job of this.active.values()) {
      active += job.pool === pool ? 1 : 0;
    }
    return active;
  }

  /** The next due job of the types, now `running` (A-6.4). */
  private claim(types: string[]): Job | undefined {
    const next = this.database.db.select({ id: jobs.id }).from(jobs)
      .where(and(eq(jobs.status, 'queued'), inArray(jobs.type, types), lte(jobs.runAt, new Date())))
      .orderBy(asc(jobs.runAt), asc(jobs.id))
      .limit(1);
    return this.database.db.update(jobs)
      .set({ status: 'running', attempts: sql`${jobs.attempts} + 1` })
      .where(eq(jobs.id, next))
      .returning()
      .get();
  }

  private run(job: Job, pool: JobPool): void {
    const definition = this.definitionOf(job.type);
    const controller = new AbortController();
    let lastProgressAt = Number.NEGATIVE_INFINITY;
    const running: RunningJob = {
      id: job.id,
      userId: job.userId,
      payload: JSON.parse(job.payload) as unknown,
      attempt: job.attempts,
      signal: controller.signal,
      reportProgress: percent => {
        const now = Date.now();
        if (now - lastProgressAt < PROGRESS_INTERVAL_MS) {
          return;
        }
        lastProgressAt = now;
        const progress = Math.min(100, Math.max(0, Math.round(percent)));
        this.database.db.update(jobs).set({ progress }).where(eq(jobs.id, job.id)).run();
        if (job.userId !== null) {
          this.events.publish(job.userId, { type: 'job.progress', jobId: job.id, percent: progress });
        }
      }
    };
    const active: ActiveJob = { job, pool, controller, cancelled: false, settled: Promise.resolve() };
    this.active.set(job.id, active);
    active.settled = Promise.resolve()
      .then(() => definition.handler(running))
      .then(
        result => this.finish(job, { status: 'done', result: result === undefined ? null : JSON.stringify(result) }),
        (error: unknown) => this.handleFailure(active, definition, error)
      )
      .catch((error: unknown) => this.logger.error({ err: error, jobId: job.id }, 'Could not record a job outcome'))
      .finally(() => {
        this.active.delete(job.id);
        this.wake();
      });
  }

  private handleFailure(active: ActiveJob, definition: JobTypeDefinition, error: unknown): void {
    const { job } = active;
    if (active.cancelled) {
      this.finish(job, { status: 'cancelled' });
      return;
    }
    if (!this.running) {
      // Stopped by shutdown: left `running`, so that the next start resolves it by its type (A-6.8).
      return;
    }
    const errorCode = codeOf(error);
    if (job.attempts < (definition.maxAttempts ?? 1)) {
      const delay = definition.retryDelayMs?.(job.attempts) ?? 0;
      this.database.db.update(jobs)
        .set({ status: 'queued', runAt: new Date(Date.now() + delay), errorCode })
        .where(eq(jobs.id, job.id))
        .run();
      this.logger.warn({ jobId: job.id, type: job.type, errorCode, attempt: job.attempts }, 'A job failed; retrying');
      return;
    }
    this.logger.warn({ jobId: job.id, type: job.type, errorCode }, 'A job failed');
    this.finish(job, { status: 'failed', errorCode });
  }

  private finish(
    job: Job,
    outcome: { status: 'done'; result: string | null; } | { status: 'failed'; errorCode: string; } | {
      status: 'cancelled';
    }
  ): void {
    this.database.db.update(jobs).set({ ...outcome, finishedAt: new Date() }).where(eq(jobs.id, job.id)).run();
    this.publishFinished(job, outcome.status);
    const repeatEveryMs = this.types.get(job.type)?.repeatEveryMs;
    if (repeatEveryMs !== undefined) {
      this.enqueue({
        type: job.type,
        payload: {},
        dedupeKey: repeatKeyOf(job.type),
        runAt: new Date(Date.now() + repeatEveryMs)
      });
    }
  }

  private publishFinished(job: Job, outcome: 'done' | 'failed' | 'cancelled'): void {
    if (job.userId !== null) {
      this.events.publish(job.userId, { type: 'job.finished', jobId: job.id, outcome });
    }
  }

  private unfinishedWithKey(dedupeKey: string): number | undefined {
    return this.database.db.select({ id: jobs.id }).from(jobs)
      .where(and(eq(jobs.dedupeKey, dedupeKey), inArray(jobs.status, UNFINISHED)))
      .get()?.id;
  }

  private definitionOf(type: string): JobTypeDefinition {
    const definition = this.types.get(type);
    if (definition === undefined) {
      throw new Error(`Unknown job type ${type}`);
    }
    return definition;
  }
}

const repeatKeyOf = (type: string) => `repeat:${type}`;

const spreadTime = () => new Date(Date.now() + Math.floor(Math.random() * START_SPREAD_MS));

/** `error.code` when it is a string, else `failed`. */
function codeOf(error: unknown): string {
  const code = (error as { code?: unknown; } | null)?.code;
  return typeof code === 'string' ? code : 'failed';
}

function assertNoSecret(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecret(item, `${path}[${index}]`));
  } else if (typeof value === 'object' && value !== null) {
    for (const [ key, item ] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) {
        throw new Error(`A job payload must not contain a secret (${path}.${key}, A-6.3)`);
      }
      assertNoSecret(item, `${path}.${key}`);
    }
  }
}
