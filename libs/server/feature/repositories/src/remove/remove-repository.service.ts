import { DATABASE, Database, repositories } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { WorkingTreeLock } from '@front-burner/server-core-git';
import { JobRunner } from '@front-burner/server-core-jobs';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { DATA_LAYOUT, DataLayout, newRemovedName } from '@front-burner/server-core-storage';
import { confirmsName, wouldLoseWork } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { ownRow, RepositoryQueries } from '../repositories/repository-queries';
import { DELETE_WORKING_COPY_JOB_TYPE, DeleteWorkingCopyJobPayload } from './delete-working-copy.job';
import { RemovalCheck } from './removal-check';

/**
 * **Remove repository** (RM-17 to RM-21, the job of the same name in A-6). The
 * request does what must be immediate: it cancels the repository's jobs,
 * deletes its row (its sync state and jobs go by cascade, A-4.5b) and moves
 * its working copy into `tmp/`. A job deletes the folder there, so that a large
 * working copy does not hold the request (RM-21, NF-2.8). Saved credentials,
 * keys and known hosts are not touched (RC-10).
 */
@Injectable()
export class RemoveRepositoryService {
  private readonly logger = new Logger(RemoveRepositoryService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly queries: RepositoryQueries,
    private readonly check: RemovalCheck,
    private readonly runner: JobRunner,
    private readonly lock: WorkingTreeLock,
    private readonly events: EventsHub,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  /**
   * Removes the user's repository in any status. When removing would lose
   * work, `confirmName` must be its name (RM-18), and the check runs again
   * inside the working-tree lock, so that a file saved since the dialog opened
   * is caught.
   *
   * The jobs are cancelled, and a running clone awaited, before the lock is
   * taken: a pull or a push waits for that lock, so waiting for them inside it
   * would hold the request until A-1.14's grace runs out. The jobs queued
   * meanwhile are cancelled again inside the lock, and go with the row.
   *
   * @throws ApiErrorException `404 not-found`, also for another user's repository (RM-1);
   *   `409 removal-needs-confirmation` with the check's answer as params; nothing changed.
   */
  async remove(userId: number, repositoryId: number, confirmName: string | undefined): Promise<void> {
    // Before anything changes: a refusal here cancels no job.
    await this.confirm(userId, repositoryId, confirmName);
    await this.runner.cancel({ repositoryId });
    const trash = await this.lock.run(repositoryId, async () => {
      const row = await this.confirm(userId, repositoryId, confirmName);
      // Not awaited: what started since can wait for this lock, and a cancelled job changes nothing after it.
      void this.runner.cancel({ repositoryId });
      this.database.db.delete(repositories).where(eq(repositories.id, row.id)).run();
      return this.moveWorkingCopy(userId, repositoryId);
    });
    this.queueDeletion(repositoryId, trash);
    this.events.publish(userId, { type: 'repository.removed', repositoryId });
    this.logger.log(`Repository ${repositoryId} removed`);
  }

  /** The row, when removing it loses nothing or the name confirms it. */
  private async confirm(userId: number, repositoryId: number, confirmName: string | undefined) {
    const row = ownRow(this.queries.find(userId, repositoryId));
    const lost = await this.check.of(userId, repositoryId);
    if (wouldLoseWork(lost) && !confirmsName(row.name, confirmName)) {
      throw new ApiErrorException(409, 'removal-needs-confirmation', lost);
    }
    return row;
  }

  /**
   * Moves the working copy into `tmp/` with one rename (NF-5.3), under a name
   * made from the ID only (A-6.3). A repository whose clone never finished has
   * none: null. `tmp/` is emptied on every start (NF-5.1), so a restart before
   * the job ran leaves nothing behind.
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
