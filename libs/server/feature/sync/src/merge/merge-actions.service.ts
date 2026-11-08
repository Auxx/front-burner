import { EventsHub } from '@front-burner/server-core-events';
import { GitMerge } from '@front-burner/server-core-git';
import { OpenableRepository } from '@front-burner/server-feature-files';
import { Injectable } from '@nestjs/common';
import { toGitApiError } from '../git/git-api-errors';
import { MergeRecord } from '../state/merge-record';
import { SyncStateStore } from '../state/sync-state.store';
import { MergeGuard } from './merge-guard';

/** What a user does to the merge in progress (REQ-GIT-003). */
@Injectable()
export class MergeActions {
  constructor(
    private readonly repositories: OpenableRepository,
    private readonly guard: MergeGuard,
    private readonly merges: GitMerge,
    private readonly syncState: SyncStateStore,
    private readonly mergeRecord: MergeRecord,
    private readonly events: EventsHub
  ) {}

  /**
   * Puts the branch, the files and the index back as they were before the pull
   * (GC-24, D-4.5). Clients are told whenever it got as far as trying: an abort
   * that fails partway may have changed files.
   *
   * @throws ApiErrorException `no-merge-in-progress`, `git-timeout`
   */
  async abort(userId: number, repositoryId: number): Promise<void> {
    const root = this.repositories.root(userId, repositoryId);
    let tried = false;
    try {
      await this.guard.change(repositoryId, root, () => {
        tried = true;
        return this.goBack(repositoryId, root);
      });
    } catch (error) {
      toGitApiError(error);
    } finally {
      if (tried) {
        this.events.publish(userId, { type: 'files.changed', repositoryId, folders: 'all' });
        this.events.publish(userId, { type: 'git.changed', repositoryId });
      }
    }
  }

  /**
   * A merge never moves `HEAD`, so a pull's record is `HEAD` itself. Another record
   * is not this merge's: it is left after a restore, or this merge is one that git
   * started without a pull. Going back to it would take later commits off the
   * branch, and could lose uncommitted changes that git's own abort keeps, so the
   * merge ends that way and the record stays as it is.
   */
  private async goBack(repositoryId: number, root: string): Promise<void> {
    const recorded = this.syncState.record(repositoryId).recordedCommit ?? await this.merges.recordedCommit(root);
    if (recorded === null || recorded !== await this.merges.head(root)) {
      await this.merges.abort(root);
      return;
    }
    // Not `git merge --abort`, which fails with "Entry not uptodate" when a resolved
    // file differs from the index. The working copy was clean before the pull (GA-26).
    await this.merges.resetTo(root, recorded);
    await this.mergeRecord.restoreEarlier(repositoryId, root);
  }
}
