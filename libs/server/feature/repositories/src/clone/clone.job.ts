import { DATABASE, Database, Job, repositories, Repository } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { GitCredentials, GitEngine, GitOperationError } from '@front-burner/server-core-git';
import { JobRunner, RunningJob } from '@front-burner/server-core-jobs';
import { DATA_LAYOUT, DataLayout } from '@front-burner/server-core-storage';
import { KnownHostsService, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import type { RepositoryError } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CLONE_JOB_TYPE, CloneJobPayload } from '../add/add-repository.service';
import { CloneKeys } from './clone-keys';

/** How many clones of one user may wait or run at once (NF-11.4). */
const CLONE_PER_USER_LIMIT = 3;

/**
 * The background clone of a new repository (AR-49 to AR-54, the **Clone** job
 * of A-6). Its outcome sets the repository's status and tells the owner's
 * tabs (DS-23).
 */
@Injectable()
export class CloneJob implements OnModuleInit {
  private readonly logger = new Logger(CloneJob.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly runner: JobRunner,
    private readonly engine: GitEngine,
    private readonly saved: SavedCredentialsService,
    private readonly knownHosts: KnownHostsService,
    private readonly cloneKeys: CloneKeys,
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
          knownHosts: this.knownHosts.linesFor(row.userId)
        });
      } catch (error) {
        if (error instanceof GitOperationError) {
          // git's error, with credentials removed by the engine (AR-53, NF-10.5).
          this.logger.warn(`Clone of repository ${row.id} failed with ${error.code}: ${error.detail.trim()}`);
        }
        throw error;
      }
    } finally {
      this.cloneKeys.release(job.id);
    }
  }

  /** Read at run time; a protected key only from the copy held since the job was queued (AR-49). */
  private credentialsFor(jobId: number, row: Repository): GitCredentials {
    if (row.credentialId === null) {
      return { kind: 'none' };
    }
    const credential = this.saved.findOwned(row.userId, row.credentialId);
    if (credential.kind === 'ssh-key' && credential.sshPassphraseProtected) {
      const key = this.cloneKeys.take(jobId);
      if (key === undefined) {
        throw Object.assign(new Error('The clone\'s key is locked'), { code: 'key-locked' });
      }
      return { kind: 'ssh', key };
    }
    // HTTPS credentials and unprotected keys need no session.
    return this.saved.resolveForGit(row.userId, '', credential.id, { touch: false });
  }

  private finished(job: Job, outcome: 'done' | 'failed' | 'cancelled', errorCode: string | null): void {
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
      .set({ status: error === null ? 'ready' : 'error', errorCode: error })
      .where(eq(repositories.id, job.repositoryId))
      .returning()
      .get();
    if (row !== undefined) {
      this.events.publish(row.userId, { type: 'repository.status', repositoryId: row.id, status: row.status, error });
    }
  }
}
