import type { Job } from '@front-burner/server-core-database';
import { JobRunner, RunningJob } from '@front-burner/server-core-jobs';
import { JobKeys } from '@front-burner/server-feature-credentials';
import type { GitJobOutcome } from '@front-burner/shared-contracts';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { FetchStep } from './fetch-step';

export const FETCH_JOB_TYPE = 'sync.fetch';

/** Never a secret (A-6.3); a fetch the user started needs nothing else. */
export type FetchJobPayload = Record<string, never>;

/** The dedupe key of the fetch a user started, so that a second request gets the same job. */
export const fetchDedupeKey = (repositoryId: number) => `fetch-now:${repositoryId}`;

/**
 * The fetch `FetchScheduler` queues (A-6, GA-33). A type of its own, not in
 * `GIT_JOB_TYPES`, so that the status does not report it as a network job and
 * **Fetch** does not flicker every 2 minutes (GA-9 is about what the user started).
 */
export const BACKGROUND_FETCH_JOB_TYPE = 'sync.fetch-background';

/** The dedupe key of a background fetch, so that many tabs on one repository queue one job. */
export const backgroundFetchDedupeKey = (repositoryId: number) => `fetch:${repositoryId}`;

/**
 * The fetch the user started with **Fetch** (GA-33), and the background fetch.
 * Allowed during a merge, which a fetch leaves alone (GC-3). A fetch git
 * refused is a job that finished, with a `failed` outcome, as a push's is
 * (plan 57's call).
 */
@Injectable()
export class FetchJob implements OnModuleInit {
  constructor(
    private readonly runner: JobRunner,
    private readonly step: FetchStep,
    private readonly jobKeys: JobKeys
  ) {}

  onModuleInit(): void {
    this.runner.register<FetchJobPayload, GitJobOutcome>({
      type: FETCH_JOB_TYPE,
      pool: 'fetch',
      // Not repeated on its own after a restart: the user asked for this one, then.
      onInterrupted: 'fail',
      maxAttempts: 1,
      handler: job => this.fetch(job),
      onFinished: job => this.finished(job)
    });
    this.runner.register<FetchJobPayload, GitJobOutcome>({
      type: BACKGROUND_FETCH_JOB_TYPE,
      pool: 'fetch',
      // Queued again after a restart (NF-9.5). Its key copy is gone then, so a
      // protected key's fetch ends as `key-locked`, which the step never stores.
      onInterrupted: 'requeue',
      maxAttempts: 1,
      handler: job => this.fetch(job),
      onFinished: job => this.finished(job)
    });
  }

  private async fetch(job: RunningJob<FetchJobPayload>): Promise<GitJobOutcome> {
    const { id, userId, repositoryId } = job;
    if (userId === null || repositoryId === null) {
      throw new Error('A fetch job needs its user and repository');
    }
    const result = await this.step.run({ id, userId, repositoryId });
    return 'failure' in result
      ? result.failure
      : { kind: 'fetched', moved: result.moved, upstreamMoved: result.upstreamMoved };
  }

  /**
   * Every end, the job's key copy goes (RC-19). `git.changed` is the step's,
   * only when something changed: clients follow the job with `job.finished`.
   */
  private finished(job: Job): void {
    this.jobKeys.release(job.id);
  }
}
