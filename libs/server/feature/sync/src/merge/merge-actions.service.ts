import { EventsHub } from '@front-burner/server-core-events';
import { ConflictEntry, ConflictKind, GitMerge, GitOperationError } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { PathRefusedError, resolveInWorkingCopy } from '@front-burner/server-core-storage';
import { FileContents, OpenableRepository, splitPath, toFilesError } from '@front-burner/server-feature-files';
import { CommitAuthors } from '@front-burner/server-feature-preferences';
import type { CommitResult, GitResolution, GitResolveRequest } from '@front-burner/shared-contracts';
import { hasConflictMarkers } from '@front-burner/shared-util';
import { Injectable, Logger } from '@nestjs/common';
import { toGitApiError } from '../git/git-api-errors';
import { MergeRecord } from '../state/merge-record';
import { SyncStateStore } from '../state/sync-state.store';
import { MergeGuard } from './merge-guard';
import { mayBeEditable, MergeStateService } from './merge-state.service';

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
    private readonly contents: FileContents,
    private readonly commitAuthors: CommitAuthors
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
   * is refused or git fails (GC-27), and no other file is touched (GC-19).
   *
   * @throws ApiErrorException `no-merge-in-progress`, `not-conflicting`,
   *   `resolution-not-allowed`, `conflict-markers-left`, `path-refused`,
   *   `entry-not-found`, `file-too-large`, `file-not-utf8`, `git-timeout`
   */
  async resolve(userId: number, repositoryId: number, request: GitResolveRequest): Promise<void> {
    await this.changeOneFile(userId, repositoryId, request.path, async root => {
      const entry = await this.resolvable(root, request);
      return () => this.merges.resolve(root, entry, request.resolution);
    });
  }

  /**
   * Puts a resolved file back as it was when the merge stopped, with its markers
   * labelled with the branch names, and marks it unresolved (GC-18), as
   * `resolve` changes a file: in the lock, all or nothing, and nothing else.
   *
   * @throws ApiErrorException `no-merge-in-progress`, `not-conflicting`,
   *   `not-resolved`, `resolution-not-allowed` (a folder at the path),
   *   `path-refused`, `git-timeout`
   */
  async startOver(userId: number, repositoryId: number, path: string): Promise<void> {
    await this.changeOneFile(userId, repositoryId, path, async root => {
      const [ entry, { branch, upstream } ] = await Promise.all([
        this.merges.conflict(root, path),
        this.merges.branchAndUpstream(root)
      ]);
      if (entry === null) {
        throw new ApiErrorException(409, 'not-conflicting');
      }
      if (!entry.resolved) {
        throw new ApiErrorException(409, 'not-resolved');
      }
      if (!await this.isFileOrMissing(root, path)) {
        throw new ApiErrorException(409, 'resolution-not-allowed');
      }
      // The names `GET …/git/merge` gives, as the merge labelled its markers (GC-5).
      const labels = { ours: branch ?? 'HEAD', theirs: upstream ?? 'MERGE_HEAD' };
      return () => this.merges.startOver(root, entry, labels);
    });
  }

  /**
   * Commits the merge as the repository's commit author, with the files as the
   * merge has them: the resolved ones and what merged by itself (GC-20, CA-1,
   * CA-2). The merge then ends (GC-21). The record stays, with the merge commit
   * beside it, for **Undo merge** (A-4.5a), when it is this merge's, as abort
   * decides (`recordOfThisMerge`). A failure leaves the merge as it was (GC-27).
   * Clients are told after a commit, and after a timeout, which may have committed.
   *
   * @throws ApiErrorException `commit-author-not-confirmed`, `no-merge-in-progress`,
   *   `merge-unresolved`, `detached-head`, `git-busy`, `git-timeout`
   */
  async commit(userId: number, repositoryId: number, message: string): Promise<CommitResult> {
    const { author, confirmed } = this.commitAuthors.forRepository(userId, repositoryId);
    if (!confirmed) {
      throw new ApiErrorException(409, 'commit-author-not-confirmed');
    }
    const root = this.repositories.root(userId, repositoryId);
    let tried = false;
    try {
      return await this.guard.change(repositoryId, root, async () => {
        // From the index, as git's commit checks, not from the conflict list.
        if (await this.merges.hasUnmerged(root).catch(toGitApiError)) {
          throw new ApiErrorException(409, 'merge-unresolved');
        }
        const recorded = await this.recordOfThisMerge(repositoryId, root).catch(toGitApiError);
        const { oid, parent } = await this.merges.commit(root, { message, author }).catch((failure: unknown) => {
          // Only a git killed at its timeout may have changed something; any other failure refused first.
          tried = failure instanceof GitOperationError && failure.code === 'timeout';
          return toGitApiError(failure);
        });
        tried = true;
        if (recorded !== null && recorded === parent) {
          this.syncState.mergeCommitted(repositoryId, oid, recorded);
        }
        return { oid };
      });
    } finally {
      if (tried) {
        // No file changes: the files on disk are already the merge's.
        this.events.publish(userId, { type: 'git.changed', repositoryId });
      }
    }
  }

  /**
   * Whether a file, or nothing, is at a conflicting file's path: with a folder
   * there, no change to the file can say what becomes of the folder. Also though
   * git named the path, a folder on the way can be a symbolic link (A-7.6).
   *
   * @throws ApiErrorException `path-refused`
   */
  private async isFileOrMissing(root: string, path: string): Promise<boolean> {
    const { type } = await resolveInWorkingCopy(root, path, { symlinkLeaf: true, mayBeMissing: true })
      .catch(toFilesError);
    return type !== 'folder' && type !== 'other';
  }

  /**
   * Runs `check` in the lock during a merge, then the change it gives back, and
   * tells clients once the change was tried, also after a failure: git puts the
   * file back, but clients may have seen it change meanwhile. Only the file's own
   * folder changes: `check` refuses a path whose folder is missing (`entry-not-found`),
   * so no folder comes back.
   */
  private async changeOneFile(
    userId: number,
    repositoryId: number,
    path: string,
    check: (root: string) => Promise<() => Promise<void>>
  ): Promise<void> {
    const root = this.repositories.root(userId, repositoryId);
    let tried = false;
    try {
      await this.guard.change(repositoryId, root, async () => {
        const change = await check(root);
        tried = true;
        await change().catch((failure: unknown) =>
          failure instanceof PathRefusedError ? toFilesError(failure) : toGitApiError(failure)
        );
      });
    } finally {
      if (tried) {
        const [ folder ] = splitPath(path);
        this.events.publish(userId, { type: 'files.changed', repositoryId, folders: [ folder ] });
        this.events.publish(userId, { type: 'git.changed', repositoryId });
      }
    }
  }

  /** The entry of an unresolved file that the resolution suits, or why not. */
  private async resolvable(root: string, { path, resolution, force }: GitResolveRequest): Promise<ConflictEntry> {
    const entry = await this.merges.conflict(root, path);
    if (entry === null || entry.resolved) {
      throw new ApiErrorException(409, 'not-conflicting');
    }
    if (!ALLOWED[resolution].includes(entry.kind) || !await this.isFileOrMissing(root, path)) {
      throw new ApiErrorException(409, 'resolution-not-allowed');
    }
    if (resolution === 'mark-resolved') {
      if (!mayBeEditable(entry)) {
        throw new ApiErrorException(409, 'resolution-not-allowed');
      }
      // Read once; what keeps the editor from it, such as its size, says so with its own code (ED-2).
      const text = await this.contents.readTracked(root, path).catch(toFilesError);
      if (!await this.mergeState.isEditableText(root, entry, text)) {
        throw new ApiErrorException(409, 'resolution-not-allowed');
      }
      if (!force && hasConflictMarkers(text)) {
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
