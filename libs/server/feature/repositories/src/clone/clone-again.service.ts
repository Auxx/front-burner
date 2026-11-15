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
import type { RequestUser } from '../add/add-repository.service';
import { ownRow, RepositoryQueries, toSummary } from '../repositories/repository-queries';
import { moveWorkingCopy, queueWorkingCopyDeletion, restoreWorkingCopy } from '../working-copy/old-working-copy';
import { hasUnfinishedClone, queueClone } from './clone-queue';

const notInError = (status: string) => new ApiErrorException(409, 'repository-not-in-error', { status });

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
   * the network lock too, which a fetch, pull or push holds while its git runs
   * (A-5.3). The checks come first, and a refusal changes nothing. What is left
   * of the working copy is moved into `tmp/`, so that the clone can move the
   * new one into place, and one transaction sets the status `cloning`, clears
   * the error record and the sync state and queues the clone; if it fails, the
   * working copy is put back and nothing else has changed.
   *
   * Then, before the runner can start the clone: the work queued behind the
   * lock for the old working copy is told to refuse (`markReplaced`); the
   * repository's fetches, pulls and pushes are cancelled _(plan 112's call)_;
   * `repository.status` is published, so that it comes before the clone's own
   * end; and a job deletes the old working copy. Delete folder jobs are left to
   * run: they touch only `tmp/`.
   *
   * @throws ApiErrorException `404 not-found`, also for another user's repository (RM-1);
   *   `409 repository-not-in-error` with `{ status }` (RM-2); `409 key-locked` with the key,
   *   or `409 credentials-missing` (RC-16, NF-8.6); `429 too-many-jobs` (NF-11.4).
   */
  cloneAgain(user: RequestUser, repositoryId: number): Promise<RepositorySummary> {
    return this.workingTreeLock.run(repositoryId, () => {
      const row = ownRow(this.queries.find(user.id, repositoryId));
      if (row.status !== 'error') {
        // A clone that is queued or running is `cloning`: a second retry ends here.
        throw notInError(row.status);
      }
      if (hasUnfinishedClone(this.database.db, repositoryId)) {
        // Whatever the row says, a clone is still on its way: queueing another would only find it.
        throw notInError('cloning');
      }
      // Before anything changes: a locked key is asked for, never cloned without (RC-16, RC-19).
      const credentialId = row.credentialId;
      const credentials = credentialId === null
        ? undefined
        : { credentialId, key: this.saved.keyForJob(user.id, user.sessionId, credentialId) };
      return this.networkLock.run(repositoryId, async () => {
        const moved = await moveWorkingCopy(this.layout, user.id, repositoryId);
        let queued;
        try {
          queued = this.database.db.transaction(tx => {
            const updated = tx.update(repositories)
              .set({ status: 'cloning', errorCode: null, errorDetail: null, errorRequestId: null })
              .where(and(eq(repositories.id, repositoryId), eq(repositories.userId, user.id)))
              .returning()
              .get();
            if (updated === undefined) {
              // Nothing else changes the row while the lock is held; refused rather than cloned without one.
              throw new ApiErrorException(404, 'not-found');
            }
            tx.delete(syncState).where(eq(syncState.repositoryId, repositoryId)).run();
            return { updated, jobId: queueClone(this.runner, tx, user, repositoryId) };
          });
        } catch (error) {
          await restoreWorkingCopy(this.layout, this.logger, user.id, repositoryId, moved);
          throw error;
        }
        // Synchronously from here, before the runner's loop can start the clone (AR-49).
        this.workingTreeLock.markReplaced(repositoryId);
        if (credentials?.key !== undefined) {
          this.jobKeys.hold(queued.jobId, credentials.credentialId, credentials.key);
        }
        // Not waited for: what still runs waits for these locks, and finds its signal aborted.
        void this.runner.cancel({ repositoryId, pools: [ 'fetch' ] });
        this.events.publish(user.id, { type: 'repository.status', repositoryId, status: 'cloning', error: null });
        if (moved !== null) {
          // The trash stays: its Delete folder jobs still run, and the new working copy may trash folders too.
          queueWorkingCopyDeletion(this.runner, this.logger, { repositoryId, name: moved, emptyTrash: false });
        }
        this.logger.log(`User ${user.id} is cloning repository ${repositoryId} again`);
        // A cloning repository has no warnings (RM-8).
        return toSummary(queued.updated, []);
      });
    });
  }
}
