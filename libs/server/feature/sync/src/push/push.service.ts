import { GitEngine } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type { RequestAuth } from '@front-burner/server-core-security';
import { OpenableRepository } from '@front-burner/server-feature-files';
import { Injectable } from '@nestjs/common';
import { NetworkJobs } from '../jobs/network-jobs.service';
import { PUSH_JOB_TYPE, pushDedupeKey, PushJobPayload } from './push.job';

/**
 * Starting a push (GA-3, GA-9, GA-29). The checks that need the user's session
 * run here, before the job is queued. What a client reads about it is `GitJobs`.
 */
@Injectable()
export class PushService {
  constructor(
    private readonly engine: GitEngine,
    private readonly repositories: OpenableRepository,
    private readonly networkJobs: NetworkJobs
  ) {}

  /**
   * Queues a push of the current branch, or returns the push of that branch
   * already waiting or running, as `NetworkJobs.queue` does.
   *
   * @throws ApiErrorException 409 `merge-in-progress` (GA-4), `no-branch`,
   * `no-commits`, `nothing-to-push`, then `key-locked` or `credentials-missing`.
   */
  async start(auth: Pick<RequestAuth, 'userId' | 'sessionId'>, repositoryId: number): Promise<number> {
    const { row, root } = this.repositories.open(auth.userId, repositoryId);
    const [ merging, status ] = await Promise.all([ this.engine.mergeInProgress(root), this.engine.status(root) ]);
    if (merging) {
      throw new ApiErrorException(409, 'merge-in-progress');
    }
    if (status.branch === null) {
      throw new ApiErrorException(409, 'no-branch');
    }
    if (status.noCommits) {
      throw new ApiErrorException(409, 'no-commits');
    }
    // An unpublished branch, or one whose upstream is gone, is always pushed: that creates it (GA-8, GA-29).
    if (status.upstream !== null && !status.upstreamGone && status.ahead === 0) {
      throw new ApiErrorException(409, 'nothing-to-push');
    }
    const payload: PushJobPayload = { branch: status.branch };
    return this.networkJobs.queue(auth, row, {
      type: PUSH_JOB_TYPE,
      payload,
      dedupeKey: pushDedupeKey(repositoryId, status.branch)
    });
  }
}
