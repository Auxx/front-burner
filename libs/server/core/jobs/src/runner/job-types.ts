import type { Config } from '@front-burner/server-core-config';

/** The concurrency pools of A-6.5. */
export type JobPool = 'clone' | 'fetch' | 'email' | 'housekeeping';

/** How many jobs of each pool run at once (A-6.5). */
export function jobPoolSizes(config: Pick<Config, 'cloneConcurrency'>): Record<JobPool, number> {
  return { clone: config.cloneConcurrency, fetch: 4, email: 1, housekeeping: 1 };
}

/** What a handler gets for one attempt of a job. */
export interface RunningJob<P = unknown> {
  id: number;
  userId: number | null;
  payload: P;
  /** 1 for the first attempt. */
  attempt: number;
  /** Aborted when the job is cancelled or the backend stops. */
  signal: AbortSignal;
  /** A whole percentage; published at most once a second (A-6.6). */
  reportProgress(percent: number): void;
}

/** A job type, registered by its feature in `onModuleInit`. */
export interface JobTypeDefinition<P = unknown, R = unknown> {
  type: string;
  pool: JobPool;
  handler: (job: RunningJob<P>) => Promise<R>;
  /** What happens to a job of this type left running by a stopped backend (NF-9.5, A-6.8). */
  onInterrupted: 'fail' | 'requeue';
  /** Attempts in all, the first included; default 1. */
  maxAttempts?: number;
  /** The wait before the next attempt, given the attempt that failed. */
  retryDelayMs?: (attempt: number) => number;
  /** At most this many queued or running jobs of this type per user (NF-11.4). */
  perUserLimit?: number;
  /**
   * A repeating type: the runner keeps one unfinished job of it, with the
   * dedupe key `repeat:<type>`, and queues the next one this long after each
   * finishes.
   */
  repeatEveryMs?: number;
  /** Overdue jobs of this type are spread over the first two minutes after a start (A-6.8). */
  spreadOnStart?: boolean;
}

export interface EnqueueRequest {
  type: string;
  userId?: number;
  /** JSON; never a secret (A-6.3). */
  payload: object;
  runAt?: Date;
  /** Unique among unfinished jobs (A-6.2). */
  dedupeKey?: string;
}

export interface CancelFilter {
  id?: number;
  userId?: number;
  types?: string[];
}
