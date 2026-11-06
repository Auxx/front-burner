import { DATABASE, Database, Job, jobs } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { GitEngine } from '@front-burner/server-core-git';
import { JobRunner } from '@front-burner/server-core-jobs';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type { RequestAuth } from '@front-burner/server-core-security';
import { JobKeys, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import { OpenableRepository } from '@front-burner/server-feature-files';
import {
  ERROR_CODES,
  GitJobOutcome,
  GitJobOutcomeSchema,
  GitJobState,
  GitNetworkJob
} from '@front-burner/shared-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { PUSH_JOB_TYPE, pushDedupeKey, PushJobPayload } from './push.job';

const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

/**
 * Starting a push, and what a client reads about it (GA-3, GA-9, GA-29). The
 * checks that need the user's session run here, before the job is queued.
 */
@Injectable()
export class PushService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly runner: JobRunner,
    private readonly engine: GitEngine,
    private readonly repositories: OpenableRepository,
    private readonly saved: SavedCredentialsService,
    private readonly jobKeys: JobKeys,
    private readonly events: EventsHub
  ) {}

  /**
   * Queues a push of the current branch, or returns the push of that branch
   * already waiting or running. A protected key must be unlocked in this session; the job gets
   * its own copy (RC-19), and the request keeps the unlock alive (AR-31). Publishes
   * `git.changed`, so that the user's other tabs read the status's `networkJob` and
   * show the push as running (GA-9) _(plan 58's call)_.
   *
   * @throws ApiErrorException 409 `merge-in-progress` (GA-4), `no-branch`,
   * `no-commits`, `nothing-to-push`, then `key-locked` or `credentials-missing`.
   */
  async start(auth: Pick<RequestAuth, 'userId' | 'sessionId'>, repositoryId: number): Promise<number> {
    const { userId, sessionId } = auth;
    const { row, root } = this.repositories.open(userId, repositoryId);
    const [ merging, status ] = await Promise.all([ this.engine.mergeInProgress(root), this.engine.status(root) ]);
    if (merging) {
      throw new ApiErrorException(409, 'merge-in-progress');
    }
    if (status.branch === null) {
      throw new ApiErrorException(409, 'no-branch');
    }
    if (status.noCommits) {
      throw new ApiErrorException(409, 'no-commits');
    }
    // An unpublished branch, or one whose upstream is gone, is always pushed: that creates it (GA-8, GA-29).
    if (status.upstream !== null && !status.upstreamGone && status.ahead === 0) {
      throw new ApiErrorException(409, 'nothing-to-push');
    }
    const heldKey = row.credentialId === null
      ? undefined
      : this.saved.keyForJob(userId, sessionId, row.credentialId);
    const payload: PushJobPayload = { branch: status.branch };
    const jobId = this.runner.enqueue({
      type: PUSH_JOB_TYPE,
      userId,
      repositoryId,
      payload,
      dedupeKey: pushDedupeKey(repositoryId, status.branch)
    });
    // Synchronously after queueing, before the runner's loop can start the job.
    if (heldKey !== undefined && row.credentialId !== null) {
      this.jobKeys.hold(jobId, row.credentialId, heldKey);
    }
    this.events.publish(userId, { type: 'git.changed', repositoryId });
    return jobId;
  }

  /**
   * One of the repository's git jobs. Another user's job, or one of another
   * repository, is answered like a missing one (GA-1).
   */
  state(userId: number, repositoryId: number, jobId: number): GitJobState {
    const job = this.database.db.select().from(jobs).where(and(
      eq(jobs.id, jobId),
      eq(jobs.userId, userId),
      eq(jobs.repositoryId, repositoryId),
      eq(jobs.type, PUSH_JOB_TYPE)
    )).get();
    // The job's user and repository match, so the repository is the user's.
    if (job === undefined) {
      throw new ApiErrorException(404, 'not-found');
    }
    return { status: job.status, outcome: outcomeOf(job) };
  }

  /** The repository's unfinished push, so that a reloaded page can follow it (GA-9). */
  networkJob(userId: number, repositoryId: number): GitNetworkJob | null {
    const job = this.database.db.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.userId, userId),
      eq(jobs.repositoryId, repositoryId),
      eq(jobs.type, PUSH_JOB_TYPE),
      inArray(jobs.status, [ 'queued', 'running' ])
    )).orderBy(desc(jobs.id)).get();
    return job === undefined ? null : { id: job.id, type: 'push' };
  }
}

/**
 * A finished job's outcome. A job the runner failed, such as one a restart
 * interrupted, has its error code and no params; a code without text is
 * reported as `internal`.
 */
function outcomeOf(job: Job): GitJobOutcome | null {
  if (job.status === 'done') {
    return job.result === null ? null : GitJobOutcomeSchema.parse(JSON.parse(job.result));
  }
  if (job.status === 'failed') {
    const code = job.errorCode !== null && KNOWN_CODES.has(job.errorCode) ? job.errorCode : 'internal';
    return { kind: 'failed', code, params: {} };
  }
  return null;
}
