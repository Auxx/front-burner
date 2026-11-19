import { keepingLastValue, METRICS_PREFIX } from '@front-burner/server-core-observability';
import { Logger } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export const JOB_DURATION = `${METRICS_PREFIX}job_duration_seconds`;
export const JOB_FAILURES = `${METRICS_PREFIX}job_failures_total`;
export const JOBS_QUEUED = `${METRICS_PREFIX}jobs_queued`;
export const CLONES = `${METRICS_PREFIX}clones`;

/** How an attempt of a job that ran ended: `retried` when it failed and the job was queued again. */
export type JobResult = 'done' | 'failed' | 'cancelled' | 'retried';

/** The job queue as one read sees it. */
export interface JobQueue {
  /** Queued jobs by type, registered types only. */
  queuedByType: ReadonlyMap<string, number>;
  /** Clone-pool jobs running now, and due ones waiting for a free slot. */
  clones: { running: number; waiting: number; };
}

/** What the job metrics read on each scrape. */
export interface JobQueueReader {
  /** The registered job types. */
  types(): readonly string[];
  /** Reads the queue. */
  queue(): JobQueue;
}

/**
 * The job runner's metrics (NF-10.11, A-6.6). Every label value is a
 * registered job type or a fixed word: never a user, a repository or a path.
 */
export class JobMetrics {
  private readonly duration: Histogram<'type' | 'result'>;
  private readonly failures: Counter<'type'>;

  constructor(registry: Registry, reader: JobQueueReader) {
    const logger = new Logger(JobMetrics.name);
    this.duration = new Histogram({
      name: JOB_DURATION,
      help: 'Duration in seconds of job attempts that ran, by job type and result (done, failed, cancelled or '
        + 'retried).',
      labelNames: [ 'type', 'result' ] as const,
      buckets: [ 0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 300, 900 ],
      registers: [ registry ]
    });
    this.failures = new Counter({
      name: JOB_FAILURES,
      help: 'Jobs that ended failed, by job type.',
      labelNames: [ 'type' ] as const,
      registers: [ registry ]
    });
    // One read per scrape, shared by both gauges so that they agree: a scrape
    // collects every metric before it awaits anything.
    let read: JobQueue | undefined;
    const queue = (): JobQueue => {
      if (read === undefined) {
        read = reader.queue();
        void Promise.resolve().then(() => read = undefined);
      }
      return read;
    };
    new Gauge({
      name: JOBS_QUEUED,
      help: 'Jobs waiting to run, by job type, due or not.',
      labelNames: [ 'type' ] as const,
      registers: [ registry ],
      collect: keepingLastValue<Gauge<'type'>>(logger, 'the queued jobs', gauge => {
        const { queuedByType } = queue();
        for (const type of reader.types()) {
          gauge.set({ type }, queuedByType.get(type) ?? 0);
        }
      })
    });
    new Gauge({
      name: CLONES,
      help: 'Clones running, and clones due to run that wait for a free slot.',
      labelNames: [ 'state' ] as const,
      registers: [ registry ],
      collect: keepingLastValue<Gauge<'state'>>(logger, 'the clones', gauge => {
        const { running, waiting } = queue().clones;
        gauge.set({ state: 'running' }, running);
        gauge.set({ state: 'waiting' }, waiting);
      })
    });
  }

  /** A new job type starts at zero failures, so that it appears before its first one. */
  registered(type: string): void {
    this.failures.inc({ type }, 0);
  }

  /** An attempt of a job that ran ended: by its result, after `seconds`. */
  ran(type: string, result: JobResult, seconds: number): void {
    this.duration.observe({ type, result }, seconds);
  }

  /** A job ended failed, whether it ran or not (an interrupted one, NF-9.5). */
  failed(type: string): void {
    this.failures.inc({ type });
  }
}
