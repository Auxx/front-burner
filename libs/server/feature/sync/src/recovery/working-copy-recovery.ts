import { GitMerge } from '@front-burner/server-core-git';
import { DATA_LAYOUT, DataLayout } from '@front-burner/server-core-storage';
import { RepositoryQueries } from '@front-burner/server-feature-repositories';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SyncStateStore } from '../state/sync-state.store';

/**
 * On start, each working copy returns to a known state (A-5.15, NF-9.4, NF-9.5):
 * stale locks go, a merge that was cut short is undone, a merge waiting for the
 * user stays, and the index is refreshed.
 *
 * `merge_applying` tells the two kinds of merge apart. With the flag still set,
 * nothing was resolved yet, even if git got as far as a `MERGE_HEAD`, so the
 * merge is undone and the user can pull again.
 *
 * Runs in `onModuleInit`, which Nest awaits before any `onApplicationBootstrap`:
 * the job runner starts in that hook, and until then no git command runs, so the
 * locks really are stale and no job sees a working copy halfway through this.
 */
@Injectable()
export class WorkingCopyRecovery implements OnModuleInit {
  private readonly logger = new Logger(WorkingCopyRecovery.name);

  constructor(
    private readonly repositories: RepositoryQueries,
    private readonly merges: GitMerge,
    private readonly syncState: SyncStateStore,
    @Inject(DATA_LAYOUT) private readonly layout: DataLayout
  ) {}

  /** One working copy at a time; one that fails is logged, and stops neither the others nor the start. */
  async onModuleInit(): Promise<void> {
    for (const { id, userId } of this.repositories.ready()) {
      const workingCopy = this.layout.workingCopy(userId, id);
      // `WorkingCopyCheck` reports one that is gone (RM-6).
      if (!existsSync(join(workingCopy, '.git'))) {
        continue;
      }
      try {
        await this.recover(id, workingCopy);
      } catch (error) {
        this.logger.warn(`Recovery of repository ${id} failed: ${String(error)}`);
      }
    }
  }

  private async recover(repositoryId: number, workingCopy: string): Promise<void> {
    await this.merges.removeStaleLocks(workingCopy);
    const { applying, recordedCommit } = this.syncState.record(repositoryId);
    if (applying && recordedCommit !== null) {
      await this.merges.undoCutShort(workingCopy, recordedCommit);
      await this.restoreEarlier(repositoryId, workingCopy);
      this.logger.log({ repositoryId, commit: recordedCommit }, 'A merge that was cut short was undone');
    }
    await this.merges.refreshIndex(workingCopy);
  }

  /** The record of an earlier merge comes back, for **Undo merge** (GC-25); without one, the ref goes. */
  private async restoreEarlier(repositoryId: number, workingCopy: string): Promise<void> {
    const earlier = this.syncState.restoreEarlier(repositoryId);
    if (earlier === null) {
      await this.merges.forgetRecord(workingCopy);
    } else {
      await this.merges.keepRecord(workingCopy, earlier);
    }
  }
}
