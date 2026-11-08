import { GitEngine, GitMerge } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type { RequestAuth } from '@front-burner/server-core-security';
import { OpenableRepository } from '@front-burner/server-feature-files';
import { Injectable } from '@nestjs/common';
import { NetworkJobs } from '../jobs/network-jobs.service';
import { PULL_JOB_TYPE, pullDedupeKey, PullJobPayload } from './pull.job';
import { sameNameRemote } from './same-name-remote';

/**
 * Starting a pull (GA-3, GA-25, GA-26). The checks that need the user's
 * session run here, before the job is queued; the job makes the others again
 * inside the working-tree lock. What a client reads about it is `GitJobs`.
 */
@Injectable()
export class PullService {
  constructor(
    private readonly engine: GitEngine,
    private readonly merge: GitMerge,
    private readonly repositories: OpenableRepository,
    private readonly networkJobs: NetworkJobs
  ) {}

  /**
   * Queues a pull of the current branch, or returns the pull of that branch
   * already waiting or running, as `NetworkJobs.queue` does.
   *
   * @throws ApiErrorException 409 `merge-in-progress` (GA-4), `no-branch`,
   * `no-upstream` (no commits, an upstream that is gone, or an unpublished
   * branch without a remote branch of its name), `uncommitted-changes` (GA-26),
   * then `key-locked` or `credentials-missing` (RC-4).
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
    const hasUpstream = status.upstream !== null && !status.upstreamGone;
    if (status.noCommits || !(hasUpstream || await sameNameRemote(this.merge, root, status))) {
      throw new ApiErrorException(409, 'no-upstream');
    }
    // Ignored files are not changes (GA-11).
    if (status.changes.length > 0) {
      throw new ApiErrorException(409, 'uncommitted-changes');
    }
    const payload: PullJobPayload = { branch: status.branch };
    return this.networkJobs.queue(auth, row, {
      type: PULL_JOB_TYPE,
      payload,
      dedupeKey: pullDedupeKey(repositoryId, status.branch)
    });
  }
}
