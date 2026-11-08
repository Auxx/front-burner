import { EventsHub } from '@front-burner/server-core-events';
import { JobRunner } from '@front-burner/server-core-jobs';
import type { RequestAuth } from '@front-burner/server-core-security';
import { JobKeys, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import { OpenableRepository } from '@front-burner/server-feature-files';
import { Injectable } from '@nestjs/common';
import { FETCH_JOB_TYPE, fetchDedupeKey, FetchJobPayload } from './fetch.job';

/**
 * Starting the fetch the user asked for (GA-3, GA-9, GA-33). The checks that
 * need the user's session run here, before the job is queued. What a client
 * reads about it is `GitJobs`.
 */
@Injectable()
export class FetchService {
  constructor(
    private readonly runner: JobRunner,
    private readonly repositories: OpenableRepository,
    private readonly saved: SavedCredentialsService,
    private readonly jobKeys: JobKeys,
    private readonly events: EventsHub
  ) {}

  /**
   * Queues a fetch, or returns the one already waiting or running. Allowed
   * during a merge, which a fetch leaves alone (GC-3). A protected key must be
   * unlocked in this session; the job gets its own copy (RC-19), and the request
   * keeps the unlock alive (AR-31). Publishes `git.changed`, so that the user's
   * other tabs read the status's `networkJob` and show the fetch running (GA-9).
   *
   * @throws ApiErrorException 409 `key-locked` or `credentials-missing` (RC-4).
   */
  start(auth: Pick<RequestAuth, 'userId' | 'sessionId'>, repositoryId: number): number {
    const { userId, sessionId } = auth;
    const { row } = this.repositories.open(userId, repositoryId);
    const heldKey = row.credentialId === null
      ? undefined
      : this.saved.keyForJob(userId, sessionId, row.credentialId);
    const payload: FetchJobPayload = {};
    const jobId = this.runner.enqueue({
      type: FETCH_JOB_TYPE,
      userId,
      repositoryId,
      payload,
      dedupeKey: fetchDedupeKey(repositoryId)
    });
    // Synchronously after queueing, before the runner's loop can start the job.
    if (heldKey !== undefined && row.credentialId !== null) {
      this.jobKeys.hold(jobId, row.credentialId, heldKey);
    }
    this.events.publish(userId, { type: 'git.changed', repositoryId });
    return jobId;
  }
}
