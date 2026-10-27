import { DATABASE, Database, jobs } from '@front-burner/server-core-database';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, inArray, lt } from 'drizzle-orm';
import { JobRunner } from '../runner/job-runner';

const DAY_MS = 86_400_000;
/** Finished jobs are kept this long (A-6 job types). */
export const FINISHED_JOB_RETENTION_MS = 7 * DAY_MS;

/** Housekeeping: deletes finished jobs older than 7 days, every day. */
@Injectable()
export class FinishedJobsCleanup implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly runner: JobRunner
  ) {}

  onModuleInit(): void {
    this.runner.register({
      type: 'jobs.cleanup',
      pool: 'housekeeping',
      onInterrupted: 'requeue',
      spreadOnStart: true,
      repeatEveryMs: DAY_MS,
      handler: () => Promise.resolve({ deleted: this.deleteOld() })
    });
  }

  /** Returns how many jobs it deleted. */
  deleteOld(): number {
    return this.database.db.delete(jobs).where(and(
      inArray(jobs.status, [ 'done', 'failed', 'cancelled' ]),
      lt(jobs.finishedAt, new Date(Date.now() - FINISHED_JOB_RETENTION_MS))
    )).run().changes;
  }
}
