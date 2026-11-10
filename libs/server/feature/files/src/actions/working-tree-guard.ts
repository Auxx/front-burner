import { GitEngine, GitMerge, WorkingTreeLock } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { Injectable } from '@nestjs/common';

/** The only way the files feature changes a working tree (FB-26, A-5.3). */
@Injectable()
export class WorkingTreeGuard {
  constructor(
    private readonly lock: WorkingTreeLock,
    private readonly git: GitEngine,
    private readonly merge: GitMerge
  ) {}

  /**
   * Runs `task` inside the repository's working-tree lock, refusing it while a
   * merge or rebase is in progress. The check runs inside the lock, so that a
   * merge queued ahead of the change cannot start between the check and the change.
   *
   * @throws ApiErrorException `409 merge-in-progress`
   */
  change<T>(repositoryId: number, root: string, task: () => Promise<T>): Promise<T> {
    return this.run(repositoryId, root, undefined, task);
  }

  /**
   * Like `change`, but during a merge (not a rebase) allows the task when `path`
   * is an unresolved conflicting file (GC-12). A resolved file is still refused:
   * its content was added to the index, so a save would change the disk but not
   * what **Commit merge** commits. A non-conflicting file is refused too.
   *
   * @throws ApiErrorException `409 merge-in-progress`
   */
  changeFile<T>(repositoryId: number, root: string, path: string, task: () => Promise<T>): Promise<T> {
    return this.run(repositoryId, root, path, task);
  }

  /**
   * Shared body: acquires the lock, then refuses the operation while a git
   * operation is in progress. For `changeFile`, a save to an unresolved
   * conflicting file during a merge is allowed (GC-12), and a rebase is not
   * blocked because there is no rebase-resolution flow.
   */
  private async run<T>(
    repositoryId: number,
    root: string,
    path: string | undefined,
    task: () => Promise<T>
  ): Promise<T> {
    return this.lock.run(repositoryId, async () => {
      if (await this.git.mergeInProgress(root)) {
        if (path !== undefined && await this.merge.mergeInProgress(root)) {
          // During a merge, changeFile is allowed for unresolved conflicts.
          if (!await this.git.isUnresolved(root, path)) {
            throw new ApiErrorException(409, 'merge-in-progress');
          }
        } else if (path === undefined) {
          // change is always blocked during merge or rebase.
          throw new ApiErrorException(409, 'merge-in-progress');
        }
        // changeFile during a rebase: allowed (no rebase-resolution flow).
      }
      return task();
    });
  }
}
