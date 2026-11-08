import type { Repository } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { JobRunner } from '@front-burner/server-core-jobs';
import type { RequestAuth } from '@front-burner/server-core-security';
import { JobKeys, SavedCredentialsService } from '@front-burner/server-feature-credentials';
import { Injectable } from '@nestjs/common';

/** A network job to queue: its type, its payload (never a secret, A-6.3) and its dedupe key. */
export interface NetworkJobRequest {
  type: string;
  payload: object;
  dedupeKey: string;
}

/**
 * Queues the network jobs a user starts (push, fetch, pull), once the
 * operation's own checks have passed.
 */
@Injectable()
export class NetworkJobs {
  constructor(
    private readonly runner: JobRunner,
    private readonly saved: SavedCredentialsService,
    private readonly jobKeys: JobKeys,
    private readonly events: EventsHub
  ) {}

  /**
   * Queues the job, or returns the one with the same dedupe key already
   * waiting or running. A protected key must be unlocked in this session; the
   * job gets its own copy, held before the runner can start it (RC-19), and the
   * request keeps the unlock alive (AR-31). Publishes `git.changed`, so that the
   * user's other tabs read the status's `networkJob` and show the job running
   * (GA-9) _(plan 58's call)_.
   *
   * @throws ApiErrorException 409 `key-locked` or `credentials-missing` (RC-4),
   * before anything is queued.
   */
  queue(
    auth: Pick<RequestAuth, 'userId' | 'sessionId'>,
    row: Pick<Repository, 'id' | 'credentialId'>,
    job: NetworkJobRequest
  ): number {
    const { userId, sessionId } = auth;
    const { id: repositoryId, credentialId } = row;
    const heldKey = credentialId === null ? undefined : this.saved.keyForJob(userId, sessionId, credentialId);
    const jobId = this.runner.enqueue({ ...job, userId, repositoryId });
    // Synchronously after queueing, before the runner's loop can start the job.
    if (heldKey !== undefined && credentialId !== null) {
      this.jobKeys.hold(jobId, credentialId, heldKey);
    }
    this.events.publish(userId, { type: 'git.changed', repositoryId });
    return jobId;
  }
}
