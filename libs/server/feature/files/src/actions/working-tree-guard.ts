import { GitEngine, WorkingTreeLock } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { Injectable } from '@nestjs/common';

/** The only way the files feature changes a working tree (FB-26, A-5.3). */
@Injectable()
export class WorkingTreeGuard {
  constructor(private readonly lock: WorkingTreeLock, private readonly git: GitEngine) {}

  /**
   * Runs `task` inside the repository's working-tree lock, refusing it while a
   * merge or rebase is in progress. The check runs inside the lock, so that a
   * merge queued ahead of the change cannot start between the check and the change.
   *
   * @throws ApiErrorException `409 merge-in-progress`
   */
  change<T>(repositoryId: number, root: string, task: () => Promise<T>): Promise<T> {
    return this.lock.run(repositoryId, async () => {
      if (await this.git.mergeInProgress(root)) {
        throw new ApiErrorException(409, 'merge-in-progress');
      }
      return task();
    });
  }
}
