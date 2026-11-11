import { EventsHub } from '@front-burner/server-core-events';
import { ConflictEntry, ConflictKind, GitMerge, GitOperationError } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { PathRefusedError, resolveInWorkingCopy } from '@front-burner/server-core-storage';
import { FileContents, OpenableRepository, toFilesError } from '@front-burner/server-feature-files';
import type { GitResolution, GitResolveRequest } from '@front-burner/shared-contracts';
import { hasConflictMarkers } from '@front-burner/shared-util';
import { Injectable, Logger } from '@nestjs/common';
import { toGitApiError } from '../git/git-api-errors';
import { MergeRecord } from '../state/merge-record';
import { SyncStateStore } from '../state/sync-state.store';
import { MergeGuard } from './merge-guard';
import { MergeStateService } from './merge-state.service';

/** The kinds of file each resolution is for (GC-14 to GC-16); `mark-resolved` also needs an editable file. */
const ALLOWED: Record<GitResolution, readonly ConflictKind[]> = {
  'mark-resolved': [ 'both-changed', 'both-added' ],
  ours: [ 'both-changed', 'both-added' ],
  theirs: [ 'both-changed', 'both-added' ],
  keep: [ 'deleted-by-us', 'deleted-by-them' ],
  delete: [ 'deleted-by-us', 'deleted-by-them' ]
};

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
    private readonly events: EventsHub,
    private readonly mergeState: MergeStateService,
    private readonly contents: FileContents
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

  /**
   * Resolves one conflicting file (GC-14 to GC-16), at once on disk and in the
   * index, so that it survives a restart and any device sees it (GC-4). Waits for
   * a save in progress, through the working-tree lock. Nothing changes when it
   * is refused (GC-27), and no other file is touched (GC-19).
   *
   * @throws ApiErrorException `no-merge-in-progress`, `not-conflicting`,
   *   `resolution-not-allowed`, `conflict-markers-left`, `path-refused`, `git-timeout`
   */
  async resolve(userId: number, repositoryId: number, request: GitResolveRequest): Promise<void> {
    const root = this.repositories.root(userId, repositoryId);
    let tried = false;
    try {
      await this.guard.change(repositoryId, root, async () => {
        const entry = await this.resolvable(root, request);
        tried = true;
        await this.merges.resolve(root, entry, request.resolution).catch((failure: unknown) => {
          if (failure instanceof PathRefusedError) {
            toFilesError(failure);
          }
          return toGitApiError(failure);
        });
      });
    } finally {
      if (tried) {
        const folder = request.path.includes('/') ? request.path.slice(0, request.path.lastIndexOf('/')) : '';
        this.events.publish(userId, { type: 'files.changed', repositoryId, folders: [ folder ] });
        this.events.publish(userId, { type: 'git.changed', repositoryId });
      }
    }
  }

  /** The entry of an unresolved file that the resolution suits, or why not. */
  private async resolvable(root: string, { path, resolution, force }: GitResolveRequest): Promise<ConflictEntry> {
    const entry = (await this.merges.conflicts(root)).find(conflict => conflict.path === path);
    if (entry === undefined || entry.resolved) {
      throw new ApiErrorException(409, 'not-conflicting');
    }
    // Also though git named the path: a folder on the way can be a symbolic link (A-7.6).
    await resolveInWorkingCopy(root, path, { symlinkLeaf: true, mayBeMissing: true }).catch(toFilesError);
    if (!ALLOWED[resolution].includes(entry.kind)) {
      throw new ApiErrorException(409, 'resolution-not-allowed');
    }
    if (resolution === 'mark-resolved') {
      if (!await this.mergeState.isEditable(root, entry)) {
        throw new ApiErrorException(409, 'resolution-not-allowed');
      }
      if (!force && hasConflictMarkers(await this.contents.readTracked(root, path).catch(toFilesError))) {
        throw new ApiErrorException(409, 'conflict-markers-left');
      }
    }
    return entry;
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
