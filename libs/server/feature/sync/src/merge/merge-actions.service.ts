import { EventsHub } from '@front-burner/server-core-events';
import { GitMerge, GitOperationError } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { OpenableRepository } from '@front-burner/server-feature-files';
import { Injectable, Logger } from '@nestjs/common';
import { toGitApiError } from '../git/git-api-errors';
import { MergeRecord } from '../state/merge-record';
import { SyncStateStore } from '../state/sync-state.store';
import { MergeGuard } from './merge-guard';

/** What a user does to the merge in progress (REQ-GIT-003). */
@Injectable()
export class MergeActions {
  private readonly logger = new Logger(MergeActions.name);

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
   * @throws ApiErrorException `no-merge-in-progress`, `git-timeout`, `merge-abort-failed`
   */
  async abort(userId: number, repositoryId: number): Promise<void> {
    const root = this.repositories.root(userId, repositoryId);
    let tried = false;
    try {
      await this.guard.change(repositoryId, root, () => {
        tried = true;
        return this.goBack(repositoryId, root);
      });
    } finally {
      if (tried) {
        this.events.publish(userId, { type: 'files.changed', repositoryId, folders: 'all' });
        this.events.publish(userId, { type: 'git.changed', repositoryId });
      }
    }
  }

  private async goBack(repositoryId: number, root: string): Promise<void> {
    const recorded = await this.recordOfThisMerge(repositoryId, root);
    if (recorded === null) {
      await this.merges.abort(root).catch(failure => this.abortFailed(repositoryId, failure));
      return;
    }
    // Not `git merge --abort`, which fails with "Entry not uptodate" when a resolved
    // file differs from the index. The working copy was clean before the pull (GA-26).
    await this.merges.resetTo(root, recorded).catch(failure => this.abortFailed(repositoryId, failure));
    await this.mergeRecord.restoreEarlier(repositoryId, root);
  }

  /**
   * The commit to go back to, or `null` when no record is this merge's. A pull's
   * merge waits with no merge commit, and never moves `HEAD`, so its record is
   * `HEAD` itself. Any other record is left after a restore, or this merge is one
   * that git started without a pull. Going back to it could take later commits off
   * the branch, so the merge ends with git's own abort, and the record stays as it
   * is, for **Undo merge** of the merge it belongs to.
   */
  private async recordOfThisMerge(repositoryId: number, root: string): Promise<string | null> {
    const { recordedCommit, mergeCommit } = this.syncState.record(repositoryId);
    if (mergeCommit !== null) {
      return null;
    }
    const recorded = recordedCommit ?? await this.merges.recordedCommit(root);
    return recorded !== null && recorded === await this.merges.head(root) ? recorded : null;
  }

  /** GC-27: a failure says so with its own code. The merge is still there, so the user can try again. */
  private abortFailed(repositoryId: number, failure: unknown): never {
    if (failure instanceof GitOperationError) {
      toGitApiError(failure);
    }
    this.logger.error(`Could not abort the merge of repository ${repositoryId}: ${String(failure)}`);
    throw new ApiErrorException(500, 'merge-abort-failed');
  }
}
