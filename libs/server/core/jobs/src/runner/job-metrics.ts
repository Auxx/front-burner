import { METRICS_PREFIX } from '@front-burner/server-core-observability';
import { Logger } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export const JOB_DURATION = `${METRICS_PREFIX}job_duration_seconds`;
export const JOB_FAILURES = `${METRICS_PREFIX}job_failures_total`;
export const JOBS_QUEUED = `${METRICS_PREFIX}jobs_queued`;
export const CLONES = `${METRICS_PREFIX}clones`;

/** How a job that ran ended. */
export type JobResult = 'done' | 'failed' | 'cancelled';

/** What the job metrics read on each scrape. */
export interface JobQueueReader {
  /** The registered job types. */
  types(): readonly string[];
  /** Queued jobs by type, registered types only. */
  queuedByType(): ReadonlyMap<string, number>;
  /** Clone-pool jobs running now and waiting. */
  clones(): { running: number; waiting: number; };
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
      help: 'Duration in seconds of jobs that ran, by job type and result (done, failed or cancelled).',
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
    new Gauge({
      name: JOBS_QUEUED,
      help: 'Jobs waiting to run, by job type.',
      labelNames: [ 'type' ] as const,
      registers: [ registry ],
      // A throw would fail the whole scrape, every other metric with it: the last count stays instead.
      collect() {
        try {
          const queued = reader.queuedByType();
          for (const type of reader.types()) {
            this.set({ type }, queued.get(type) ?? 0);
          }
        } catch (error) {
          logger.warn({ err: error }, 'Could not count the queued jobs; the metric keeps its last value.');
        }
      }
    });
    new Gauge({
      name: CLONES,
      help: 'Clones running and waiting for a free slot.',
      labelNames: [ 'state' ] as const,
      registers: [ registry ],
      collect() {
        try {
          const { running, waiting } = reader.clones();
          this.set({ state: 'running' }, running);
          this.set({ state: 'waiting' }, waiting);
        } catch (error) {
          logger.warn({ err: error }, 'Could not count the clones; the metric keeps its last value.');
        }
      }
    });
  }

  /** A new job type starts at zero failures, so that it appears before its first one. */
  registered(type: string): void {
    this.failures.inc({ type }, 0);
  }

  /** A job that ran ended: by its result, after `seconds`. */
  ran(type: string, result: JobResult, seconds: number): void {
    this.duration.observe({ type, result }, seconds);
  }

  /** A job ended failed, whether it ran or not (an interrupted one, NF-9.5). */
  failed(type: string): void {
    this.failures.inc({ type });
  }
}
