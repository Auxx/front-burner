import { Database, jobs, Tx } from '@front-burner/server-core-database';
import { JobRunner } from '@front-burner/server-core-jobs';
import { and, eq, inArray } from 'drizzle-orm';

/** The job type of the background clone (AR-49). */
export const CLONE_JOB_TYPE = 'repositories.clone';

export interface CloneJobPayload {
  repositoryId: number;
  /**
   * The ID of the request that queued the clone, kept with a failed clone's
   * error (RM-10, NF-10.6); none in a job queued before it was recorded.
   */
  requestId?: string;
}

/** One unfinished clone per repository (A-6.2). */
const dedupeKeyOf = (repositoryId: number): string => `clone:${repositoryId}`;

/**
 * Queues the clone of a repository, in the transaction that sets it `cloning`,
 * with the request's ID for a failed clone's error record (RM-10). Adding and
 * cloning again share it, and so the clone's per-user limit (NF-11.4, RM-13).
 *
 * @throws ApiErrorException `429 too-many-jobs` at the limit, which rolls the transaction back.
 */
export function queueClone(
  runner: JobRunner,
  tx: Tx,
  user: { id: number; requestId?: string; },
  repositoryId: number
): number {
  const payload: CloneJobPayload = { repositoryId, requestId: user.requestId };
  return runner.enqueue({
    type: CLONE_JOB_TYPE,
    userId: user.id,
    repositoryId,
    payload,
    dedupeKey: dedupeKeyOf(repositoryId)
  }, tx);
}

/**
 * Whether a clone of the repository is still queued or running, whatever its
 * status says: queueing another would only find this one by its dedupe key.
 */
export function hasUnfinishedClone(db: Tx | Database['db'], repositoryId: number): boolean {
  return db.select({ id: jobs.id }).from(jobs)
    .where(and(eq(jobs.dedupeKey, dedupeKeyOf(repositoryId)), inArray(jobs.status, [ 'queued', 'running' ])))
    .get() !== undefined;
}
