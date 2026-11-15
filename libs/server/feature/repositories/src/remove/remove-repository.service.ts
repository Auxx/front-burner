import { DATABASE, Database, repositories } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { NetworkLock, WorkingTreeLock } from '@front-burner/server-core-git';
import { JobRunner } from '@front-burner/server-core-jobs';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { DATA_LAYOUT, DataLayout, newRemovedName } from '@front-burner/server-core-storage';
import { confirmsName, wouldLoseWork } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { CLONE_JOB_TYPE } from '../add/add-repository.service';
import { ownRow, RepositoryQueries } from '../repositories/repository-queries';
import { DELETE_WORKING_COPY_JOB_TYPE, DeleteWorkingCopyJobPayload } from './delete-working-copy.job';
import { RemovalCheck } from './removal-check';

/**
 * **Remove repository** (RM-17 to RM-21, the job of the same name in A-6). The
 * request does what must be immediate: it cancels the repository's jobs, moves
 * its working copy into `tmp/` and deletes its row (its sync state and jobs go
 * by cascade, A-4.5b). A job deletes the folder there, so that a large working
 * copy does not hold the request (RM-21, NF-2.8). Saved credentials, keys and
 * known hosts are not touched (RC-10).
 */
@Injectable()
export class RemoveRepositoryService {
  private readonly logger = new Logger(RemoveRepositoryService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly queries: RepositoryQueries,
    private readonly check: RemovalCheck,
    private readonly runner: JobRunner,
    private readonly workingTreeLock: WorkingTreeLock,
    private readonly networkLock: NetworkLock,
    private readonly events: EventsHub,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  /**
   * Removes the user's repository in any status. When removing would lose
   * work, `confirmName` must be its name (RM-18).
   *
   * Everything that touches a working copy holds the working-tree lock or the
   * network lock (A-5.3), and nothing waits for the first while holding the
   * second. So, inside the working-tree lock: the check, which a refusal ends
   * with nothing changed; cancelling every job, which kills their git; waiting
   * for a cancelled clone, which holds neither lock; then, inside the network
   * lock too, which a fetch or a push holds until its git has ended, the move
   * and the row's deletion. The jobs that wait for the working-tree lock are
   * not waited for: they run after the removal, find it marked, and do nothing.
   *
   * @throws ApiErrorException `404 not-found`, also for another user's repository (RM-1);
   *   `409 removal-needs-confirmation` with the check's answer as params; nothing changed.
   */
  async remove(userId: number, repositoryId: number, confirmName: string | undefined): Promise<void> {
    const trash = await this.workingTreeLock.run(repositoryId, async () => {
      const row = ownRow(this.queries.find(userId, repositoryId));
      const lost = await this.check.of(userId, repositoryId);
      if (wouldLoseWork(lost) && !confirmsName(row.name, confirmName)) {
        throw new ApiErrorException(409, 'removal-needs-confirmation', lost);
      }
      // A clone holds no lock: waited for here, so that it cannot rename a finished clone into place afterwards.
      const clone = this.runner.cancel({ repositoryId, types: [ CLONE_JOB_TYPE ] });
      // The others are not waited for: some of them wait for this lock.
      void this.runner.cancel({ repositoryId });
      if (!await clone) {
        // A cancelled clone moves nothing into place (GitEngine.clone), so going on is safe.
        this.logger.warn(`The cancelled clone of repository ${repositoryId} has not ended yet`);
      }
      return this.networkLock.run(repositoryId, async () => {
        const moved = await this.moveWorkingCopy(userId, repositoryId);
        try {
          this.database.db.delete(repositories).where(eq(repositories.id, row.id)).run();
        } catch (error) {
          await this.restoreWorkingCopy(userId, repositoryId, moved);
          throw error;
        }
        this.workingTreeLock.markRemoved(repositoryId);
        return moved;
      });
    });
    this.queueDeletion(repositoryId, trash);
    this.events.publish(userId, { type: 'repository.removed', repositoryId });
    this.logger.log(`Repository ${repositoryId} removed`);
  }

  /**
   * Moves the working copy into `tmp/` with one rename (NF-5.3), under a name
   * made from the ID only (A-6.3). A repository whose clone never finished has
   * none: null. `tmp/` is emptied on every start (NF-5.1), so a restart before
   * the job ran leaves nothing behind. Any other failure fails the removal
   * before anything else changed.
   */
  private async moveWorkingCopy(userId: number, repositoryId: number): Promise<string | null> {
    const name = newRemovedName(repositoryId);
    await mkdir(this.layout.tmpDir, { recursive: true });
    try {
      await rename(this.layout.workingCopy(userId, repositoryId), join(this.layout.tmpDir, name));
      return name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /** Puts the working copy back when the row could not be deleted, so that the repository stays as it was. */
  private async restoreWorkingCopy(userId: number, repositoryId: number, name: string | null): Promise<void> {
    if (name === null) {
      return;
    }
    try {
      await rename(join(this.layout.tmpDir, name), this.layout.workingCopy(userId, repositoryId));
    } catch (error) {
      this.logger.error(
        { err: error },
        `Could not put back the working copy of repository ${repositoryId}; it is in tmp/ until the next start`
      );
    }
  }

  /**
   * The row is already gone, so a job that cannot be queued does not fail the
   * removal: `tmp/` is emptied on the next start (NF-5.1).
   */
  private queueDeletion(repositoryId: number, name: string | null): void {
    try {
      this.runner.enqueue({
        type: DELETE_WORKING_COPY_JOB_TYPE,
        // Neither a user nor a repository: the row no longer exists, and the end is nobody's business.
        payload: { repositoryId, name } satisfies DeleteWorkingCopyJobPayload
      });
    } catch {
      this.logger.warn(
        `Could not queue the deletion of removed repository ${repositoryId}; tmp/ is emptied on the next start`
      );
    }
  }
}
