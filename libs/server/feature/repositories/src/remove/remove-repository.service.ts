import { DATABASE, Database, repositories } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { NetworkLock, WorkingTreeLock } from '@front-burner/server-core-git';
import { JobRunner } from '@front-burner/server-core-jobs';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { DATA_LAYOUT, DataLayout } from '@front-burner/server-core-storage';
import { confirmsName, wouldLoseWork } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { CLONE_JOB_TYPE } from '../add/add-repository.service';
import { ownRow, RepositoryQueries } from '../repositories/repository-queries';
import { moveWorkingCopy, queueWorkingCopyDeletion, restoreWorkingCopy } from './old-working-copy';
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
        // A failure here fails the removal before anything else changed.
        const moved = await moveWorkingCopy(this.layout, userId, repositoryId);
        try {
          this.database.db.delete(repositories).where(eq(repositories.id, row.id)).run();
        } catch (error) {
          await restoreWorkingCopy(this.layout, this.logger, userId, repositoryId, moved);
          throw error;
        }
        this.workingTreeLock.markRemoved(repositoryId);
        return moved;
      });
    });
    // The row is already gone, so a job that cannot be queued does not fail the removal.
    queueWorkingCopyDeletion(this.runner, this.logger, repositoryId, trash);
    this.events.publish(userId, { type: 'repository.removed', repositoryId });
    this.logger.log(`Repository ${repositoryId} removed`);
  }
}
