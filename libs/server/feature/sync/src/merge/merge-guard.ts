import { GitMerge, WorkingTreeLock } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { Injectable } from '@nestjs/common';

/** The guard of every operation that only makes sense during a merge, as `WorkingTreeGuard` is of those that do not. */
@Injectable()
export class MergeGuard {
  constructor(private readonly lock: WorkingTreeLock, private readonly merges: GitMerge) {}

  /**
   * Runs `task` inside the repository's working-tree lock, refusing it when there
   * is no merge, also during a rebase. The check runs inside the lock, so that an
   * operation queued ahead of this one can have ended the merge (A-5.3).
   *
   * @throws ApiErrorException `409 no-merge-in-progress`; `404 not-found` when
   *   the repository was removed while the task waited for the lock (RM-19);
   *   `409 repository-not-openable` when it was cloned again meanwhile (RM-12).
   */
  change<T>(repositoryId: number, root: string, task: () => Promise<T>): Promise<T> {
    const generation = this.lock.generation(repositoryId);
    return this.lock.run(repositoryId, async () => {
      if (this.lock.isRemoved(repositoryId)) {
        throw new ApiErrorException(404, 'not-found');
      }
      // Cloned again while this waited: the working copy it was meant for is gone (RM-12).
      if (this.lock.generation(repositoryId) !== generation) {
        throw new ApiErrorException(409, 'repository-not-openable', { status: 'cloning' });
      }
      if (!await this.merges.mergeInProgress(root)) {
        throw new ApiErrorException(409, 'no-merge-in-progress');
      }
      return task();
    });
  }
}
