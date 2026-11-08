import type { Job } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine, GitOperationError, NetworkLock } from '@front-burner/server-core-git';
import { JobRunner, RunningJob } from '@front-burner/server-core-jobs';
import { JobKeys, KnownHostsService } from '@front-burner/server-feature-credentials';
import { OpenableRepository } from '@front-burner/server-feature-files';
import type { GitJobOutcome } from '@front-burner/shared-contracts';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FetchStep, FetchStepJob } from '../fetch/fetch-step';
import { JobCredentials } from '../jobs/job-credentials.service';
import { networkFailure } from '../jobs/network-failure';

export const PUSH_JOB_TYPE = 'sync.push';

/** Never a secret (A-6.3). */
export interface PushJobPayload {
  /** The branch that was current when the user chose **Push** (GA-29). */
  branch: string;
}

/**
 * The dedupe key of a branch's push, so that a second request gets the same
 * job, and a push of another branch after a switch gets its own.
 */
export const pushDedupeKey = (repositoryId: number, branch: string) => `push:${repositoryId}:${branch}`;

/**
 * The push job (GA-3, GA-29 to GA-31). A push that git refused is a job that
 * finished: its result is `{ kind: 'failed', code, params }`, since
 * `jobs.error_code` has no room for the params and nothing went wrong in the
 * runner _(plan 57's call)_. The job reads its credentials when it runs; a
 * protected key only from the copy held since it was queued (RC-19). It does
 * not run during a merge that started after it was queued (GC-3), and a push
 * rejected as non-fast-forward fetches afterwards (GA-30).
 */
@Injectable()
export class PushJob implements OnModuleInit {
  private readonly logger = new Logger(PushJob.name);

  constructor(
    private readonly runner: JobRunner,
    private readonly engine: GitEngine,
    private readonly networkLock: NetworkLock,
    private readonly repositories: OpenableRepository,
    private readonly credentials: JobCredentials,
    private readonly knownHosts: KnownHostsService,
    private readonly fetchStep: FetchStep,
    private readonly jobKeys: JobKeys,
    private readonly events: EventsHub
  ) {}

  onModuleInit(): void {
    this.runner.register<PushJobPayload, GitJobOutcome>({
      type: PUSH_JOB_TYPE,
      pool: 'fetch',
      // A push is not repeated on its own after a restart: the user decides (GA-3).
      onInterrupted: 'fail',
      maxAttempts: 1,
      handler: job => this.push(job),
      onFinished: job => this.finished(job)
    });
  }

  private async push(job: RunningJob<PushJobPayload>): Promise<GitJobOutcome> {
    const { id, userId, repositoryId } = job;
    if (userId === null || repositoryId === null) {
      throw new Error('A push job needs its user and repository');
    }
    // Network steps take the network lock only, so saves never wait behind the remote (A-5.3).
    const outcome = await this.networkLock.run(repositoryId, async (): Promise<GitJobOutcome> => {
      const { row, root } = this.repositories.open(userId, repositoryId);
      const { branch } = job.payload;
      // A pull's merge may have started after the push was queued (GC-3).
      if (await this.engine.mergeInProgress(root)) {
        return { kind: 'failed', code: 'merge-in-progress', params: { branch } };
      }
      const resolved = this.credentials.resolve(job.id, userId, row);
      if ('failure' in resolved) {
        return resolved.failure;
      }
      const { credentials } = resolved;
      try {
        const result = await this.engine.push(root, {
          remoteUrl: row.remoteUrl,
          credentials,
          knownHosts: this.knownHosts.linesFor(userId),
          branch,
          singleBranch: row.cloneMode === 'single-branch'
        });
        return { kind: 'pushed', commits: result.commits, upstream: result.upstream };
      } catch (error) {
        if (!(error instanceof GitOperationError)) {
          throw error;
        }
        // git's own lines, without credentials (NF-10.5); the user gets the code and the remote's lines.
        this.logger.warn(`Push of repository ${repositoryId} failed with ${error.code}: ${error.detail.trim()}`);
        return networkFailure(error, row.credentialId !== null, { branch });
      }
    });
    if (outcome.kind === 'failed' && outcome.code === 'push-non-fast-forward') {
      await this.fetchAfterRejection({ id, userId, repositoryId });
    }
    return outcome;
  }

  /**
   * Fetches once the network lock is free, as `FetchStep` takes it, so that
   * the remote branch the push was rejected by exists and the counts show what
   * to pull (GA-30) _(plan 77's call)_. How the fetch ends changes nothing
   * about the push's outcome.
   */
  private async fetchAfterRejection(job: FetchStepJob): Promise<void> {
    try {
      const fetched = await this.fetchStep.run(job);
      if ('failure' in fetched) {
        this.logger.warn(
          `Fetch after a rejected push of repository ${job.repositoryId} failed with ${fetched.failure.code}`
        );
      }
    } catch (error) {
      this.logger.warn(`Fetch after a rejected push of repository ${job.repositoryId} failed: ${String(error)}`);
    }
  }

  /** Every end, the job's key copy goes (RC-19), and clients read the new state (A-3.11). */
  private finished(job: Job): void {
    this.jobKeys.release(job.id);
    if (job.userId !== null && job.repositoryId !== null) {
      this.events.publish(job.userId, { type: 'git.changed', repositoryId: job.repositoryId });
    }
  }
}
