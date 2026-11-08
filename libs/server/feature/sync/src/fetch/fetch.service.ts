import type { RequestAuth } from '@front-burner/server-core-security';
import { OpenableRepository } from '@front-burner/server-feature-files';
import { Injectable } from '@nestjs/common';
import { NetworkJobs } from '../jobs/network-jobs.service';
import { FETCH_JOB_TYPE, fetchDedupeKey, FetchJobPayload } from './fetch.job';

/**
 * Starting the fetch the user asked for (GA-3, GA-9, GA-33). The checks that
 * need the user's session run here, before the job is queued. What a client
 * reads about it is `GitJobs`.
 */
@Injectable()
export class FetchService {
  constructor(private readonly repositories: OpenableRepository, private readonly networkJobs: NetworkJobs) {}

  /**
   * Queues a fetch, or returns the one already waiting or running, as
   * `NetworkJobs.queue` does. Allowed during a merge, which a fetch leaves
   * alone (GC-3).
   *
   * @throws ApiErrorException 409 `key-locked` or `credentials-missing` (RC-4).
   */
  start(auth: Pick<RequestAuth, 'userId' | 'sessionId'>, repositoryId: number): number {
    const { row } = this.repositories.open(auth.userId, repositoryId);
    const payload: FetchJobPayload = {};
    return this.networkJobs.queue(auth, row, {
      type: FETCH_JOB_TYPE,
      payload,
      dedupeKey: fetchDedupeKey(repositoryId)
    });
  }
}
