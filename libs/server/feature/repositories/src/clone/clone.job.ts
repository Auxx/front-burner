import { DATABASE, Database, Job, repositories, Repository } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { GitCredentials, GitEngine, GitOperationError } from '@front-burner/server-core-git';
import { JobRunner, RunningJob } from '@front-burner/server-core-jobs';
import { DATA_LAYOUT, DataLayout } from '@front-burner/server-core-storage';
import { JobKeys, KnownHostsService, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import type { RepositoryError } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CLONE_JOB_TYPE, CloneJobPayload } from '../add/add-repository.service';

/** How many clones of one user may wait or run at once (NF-11.4). */
const CLONE_PER_USER_LIMIT = 3;

/** The longest error detail kept on a repository (RM-10). */
const ERROR_DETAIL_MAX_LENGTH = 4_000;

/**
 * git's message for a failed clone, as kept on the repository: already without
 * credentials (AR-53), trimmed, and cut to its end, where git puts the cause. A
 * timeout has none: its error code says what happened.
 */
function errorDetailOf(error: GitOperationError): string | null {
  if (error.code === 'timeout') {
    return null;
  }
  const detail = error.detail.trim();
  return detail === '' ? null : detail.slice(-ERROR_DETAIL_MAX_LENGTH);
}

/** The request that queued a clone, or null for a job queued before it was recorded. */
function requestIdOf(job: Job): string | null {
  return (JSON.parse(job.payload) as CloneJobPayload).requestId ?? null;
}

/**
 * The background clone of a new repository (AR-49 to AR-54, the **Clone** job
 * of A-6). Its outcome sets the repository's status and tells the owner's
 * tabs (DS-23).
 */
@Injectable()
export class CloneJob implements OnModuleInit {
  private readonly logger = new Logger(CloneJob.name);
  /** git's message of a failed clone, by job, from its handler until its end is recorded. */
  private readonly details = new Map<number, string | null>();

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly runner: JobRunner,
    private readonly engine: GitEngine,
    private readonly saved: SavedCredentialsService,
    private readonly knownHosts: KnownHostsService,
    private readonly jobKeys: JobKeys,
    private readonly events: EventsHub,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  onModuleInit(): void {
    this.runner.register<CloneJobPayload, void>({
      type: CLONE_JOB_TYPE,
      pool: 'clone',
      perUserLimit: CLONE_PER_USER_LIMIT,
      // A half-finished clone is not resumed: the user retries it (AR-54).
      onInterrupted: 'fail',
      maxAttempts: 1,
      handler: job => this.clone(job),
      onFinished: (job, outcome, errorCode) => this.finished(job, outcome, errorCode)
    });
  }

  private async clone(job: RunningJob<CloneJobPayload>): Promise<void> {
    try {
      const row = this.database.db.select().from(repositories)
        .where(eq(repositories.id, job.payload.repositoryId)).get();
      if (row === undefined) {
        return;
      }
      const destination = this.layout.workingCopy(row.userId, row.id);
      await mkdir(dirname(destination), { recursive: true });
      try {
        await this.engine.clone({
          remoteUrl: row.remoteUrl,
          credentials: this.credentialsFor(job.id, row),
          mode: row.cloneMode,
          branch: row.branch ?? undefined,
          tmpRoot: this.layout.tmpDir,
          destination,
          knownHosts: this.knownHosts.linesFor(row.userId),
          // Removing the repository cancels the job: git is killed, and nothing is moved into place (RM-19).
          signal: job.signal
        });
      } catch (error) {
        if (error instanceof GitOperationError) {
          // git's error, with credentials removed by the engine (AR-53, NF-10.5).
          this.logger.warn(`Clone of repository ${row.id} failed with ${error.code}: ${error.detail.trim()}`);
          this.details.set(job.id, errorDetailOf(error));
        }
        throw error;
      }
    } finally {
      this.jobKeys.release(job.id);
    }
  }

  /** Read at run time; a protected key only from the copy held since the job was queued (AR-49). */
  private credentialsFor(jobId: number, row: Repository): GitCredentials {
    if (row.credentialId === null) {
      return { kind: 'none' };
    }
    return this.saved.resolveForJob(row.userId, row.credentialId, this.jobKeys.take(jobId, row.credentialId));
  }

  private finished(job: Job, outcome: 'done' | 'failed' | 'cancelled', errorCode: string | null): void {
    // Also for a job that never ran, such as one cancelled while queued (AR-49).
    this.jobKeys.release(job.id);
    // An interrupted clone ran in an earlier process, and so has no detail.
    const detail = this.details.get(job.id) ?? null;
    this.details.delete(job.id);
    if (outcome === 'cancelled' || job.repositoryId === null) {
      return;
    }
    if (errorCode === 'interrupted') {
      this.logger.warn(`Clone of repository ${job.repositoryId} was interrupted by a stop of the backend`);
    }
    const error: RepositoryError | null = outcome === 'done'
      ? null
      : errorCode === 'timeout'
      ? 'clone-timed-out'
      : 'clone-failed';
    const row = this.database.db.update(repositories)
      .set({
        status: error === null ? 'ready' : 'error',
        errorCode: error,
        errorDetail: error === null ? null : detail,
        errorRequestId: error === null ? null : requestIdOf(job)
      })
      .where(eq(repositories.id, job.repositoryId))
      .returning()
      .get();
    if (row !== undefined) {
      this.events.publish(row.userId, { type: 'repository.status', repositoryId: row.id, status: row.status, error });
    }
  }
}
