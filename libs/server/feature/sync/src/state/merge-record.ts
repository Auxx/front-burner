import { GitMerge } from '@front-burner/server-core-git';
import { Injectable } from '@nestjs/common';
import { SyncStateStore } from './sync-state.store';

/**
 * The record of a merge is in two places: `sync_state` and `PRE_MERGE_REF`, which
 * keeps the commit from garbage collection (A-4.5a, A-5.12). The ref changes
 * first: `merge_applying` clears with the database, and while it is set, recovery
 * repeats the step. Recovery also calls `matchRef` for what a crash left between
 * the two.
 */
@Injectable()
export class MergeRecord {
  constructor(private readonly syncState: SyncStateStore, private readonly merges: GitMerge) {}

  /** Puts the earlier record back, or drops the record when there is none. */
  async restoreEarlier(repositoryId: number, root: string): Promise<void> {
    await this.pointRefAt(root, this.syncState.earlierRecordedCommit(repositoryId));
    this.syncState.restoreEarlier(repositoryId);
  }

  /** Drops the record, and any earlier one. */
  async forget(repositoryId: number, root: string): Promise<void> {
    await this.merges.forgetRecord(root);
    this.syncState.forgetRecord(repositoryId);
  }

  /**
   * Drops the record once its merge commit is on a remote branch: pushed, so
   * it can no longer be undone (A-4.5a, GC-25). A record still being applied
   * belongs to a merge under way, and stays.
   */
  async forgetIfPushed(repositoryId: number, root: string): Promise<void> {
    const { mergeCommit, applying } = this.syncState.record(repositoryId);
    if (mergeCommit !== null && !applying && await this.merges.isOnRemoteBranch(root, mergeCommit)) {
      await this.forget(repositoryId, root);
    }
  }

  /** Makes the ref say what the database says. */
  async matchRef(repositoryId: number, root: string): Promise<void> {
    await this.pointRefAt(root, this.syncState.record(repositoryId).recordedCommit);
  }

  private async pointRefAt(root: string, commit: string | null): Promise<void> {
    if (commit === null) {
      await this.merges.forgetRecord(root);
    } else {
      await this.merges.keepRecord(root, commit);
    }
  }
}
