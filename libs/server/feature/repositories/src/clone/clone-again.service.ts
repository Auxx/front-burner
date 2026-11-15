import { DATABASE, Database, repositories, syncState } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { NetworkLock, WorkingTreeLock } from '@front-burner/server-core-git';
import { JobRunner } from '@front-burner/server-core-jobs';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { DATA_LAYOUT, DataLayout } from '@front-burner/server-core-storage';
import { JobKeys, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { queueClone, RequestUser } from '../add/add-repository.service';
import { moveWorkingCopy, queueWorkingCopyDeletion, restoreWorkingCopy } from '../remove/old-working-copy';
import { ownRow, RepositoryQueries, toSummary } from '../repositories/repository-queries';

/**
 * **Retry clone** after a failed, timed out or interrupted clone (RM-11) and
 * **Clone again** after a missing or damaged working copy (RM-12): one
 * endpoint, as the error code says which applies _(plan 112's call)_. Clones
 * with the same remote, clone mode and branch, and the repository's current
 * credentials (RC-19). Keeps the name, credentials, commit author override,
 * level, last access time and date added; forgets the sync state, which
 * describes the old working copy _(plan 112's call)_.
 */
@Injectable()
export class CloneAgainService {
  private readonly logger = new Logger(CloneAgainService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly queries: RepositoryQueries,
    private readonly runner: JobRunner,
    private readonly saved: SavedCredentialsService,
    private readonly jobKeys: JobKeys,
    private readonly workingTreeLock: WorkingTreeLock,
    private readonly networkLock: NetworkLock,
    private readonly events: EventsHub,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  /**
   * Inside the working-tree lock, so that two requests never both clone, then
   * the network lock too, as removing does (A-5.3): the checks, which a refusal
   * ends with nothing changed; cancelling the repository's other jobs, which
   * would run on the old working copy or none _(plan 112's call)_; moving what
   * is left of the working copy into `tmp/`, so that the clone can move the new
   * one into place; and one transaction that sets the status `cloning`, clears
   * the error record and the sync state and queues the clone. If that fails,
   * the working copy is put back. A job then deletes the old one.
   *
   * @throws ApiErrorException `404 not-found`, also for another user's repository (RM-1);
   *   `409 repository-not-in-error` with `{ status }` (RM-2); `409 key-locked` with the key,
   *   or `409 credentials-missing` (RC-16, NF-8.6); `429 too-many-jobs` (NF-11.4).
   */
  async cloneAgain(user: RequestUser, repositoryId: number): Promise<RepositorySummary> {
    const { summary, moved } = await this.workingTreeLock.run(repositoryId, async () => {
      const row = ownRow(this.queries.find(user.id, repositoryId));
      if (row.status !== 'error') {
        // A clone that is queued or running is `cloning`: a second retry ends here.
        throw new ApiErrorException(409, 'repository-not-in-error', { status: row.status });
      }
      // Before anything changes: a locked key is asked for, never cloned without (RC-16, RC-19).
      const heldKey = row.credentialId === null
        ? undefined
        : this.saved.keyForJob(user.id, user.sessionId, row.credentialId);
      // Not waited for: some of them wait for this lock. None is a clone, as the status is not `cloning`.
      void this.runner.cancel({ repositoryId });
      return this.networkLock.run(repositoryId, async () => {
        const trash = await moveWorkingCopy(this.layout, user.id, repositoryId);
        let queued;
        try {
          queued = this.database.db.transaction(tx => {
            const updated = tx.update(repositories)
              .set({ status: 'cloning', errorCode: null, errorDetail: null, errorRequestId: null })
              .where(and(eq(repositories.id, repositoryId), eq(repositories.userId, user.id)))
              .returning()
              .get();
            tx.delete(syncState).where(eq(syncState.repositoryId, repositoryId)).run();
            return { updated: updated ?? row, jobId: queueClone(this.runner, tx, user, repositoryId) };
          });
        } catch (error) {
          await restoreWorkingCopy(this.layout, this.logger, user.id, repositoryId, trash);
          throw error;
        }
        // Synchronously after the commit, before the runner's loop can start the job (AR-49).
        if (heldKey !== undefined && row.credentialId !== null) {
          this.jobKeys.hold(queued.jobId, row.credentialId, heldKey);
        }
        // A cloning repository has no warnings (RM-8).
        return { summary: toSummary(queued.updated, []), moved: trash };
      });
    });
    // Also without a working copy: the folders trashed from it lost their cancelled Delete folder jobs.
    queueWorkingCopyDeletion(this.runner, this.logger, repositoryId, moved);
    this.events.publish(user.id, { type: 'repository.status', repositoryId, status: 'cloning', error: null });
    this.logger.log(`User ${user.id} is cloning repository ${repositoryId} again`);
    return summary;
  }
}
