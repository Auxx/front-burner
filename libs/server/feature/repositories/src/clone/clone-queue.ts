import { Database, jobs, Tx } from '@front-burner/server-core-database';
import { JobRunner } from '@front-burner/server-core-jobs';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type { DiskMonitor } from '@front-burner/server-core-storage';
import type { CloneProgress } from '@front-burner/shared-contracts';
import { and, eq, inArray } from 'drizzle-orm';

/** The job type of the background clone (AR-49). */
export const CLONE_JOB_TYPE = 'repositories.clone';

/**
 * Refuses a new clone while the server is low on storage (NF-9.7, A-3.2g).
 * Called before anything changes; a clone already queued or running goes on.
 *
 * @throws ApiErrorException `507 low-storage`.
 */
export function assertSpaceForClone(disks: Pick<DiskMonitor, 'isLow'>): void {
  if (disks.isLow()) {
    throw new ApiErrorException(507, 'low-storage');
  }
}

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
 * The unfinished clone of each of the repositories that has one, by
 * repository ID (RM-7): `waiting` while queued for the clone pool (AR-52),
 * `running` with the last progress the job reported. One query for a list.
 */
export function unfinishedClones(
  db: Tx | Database['db'],
  repositoryIds: readonly number[]
): Map<number, CloneProgress> {
  if (repositoryIds.length === 0) {
    return new Map();
  }
  const rows = db.select({ id: jobs.id, repositoryId: jobs.repositoryId, status: jobs.status, progress: jobs.progress })
    .from(jobs)
    .where(and(
      eq(jobs.type, CLONE_JOB_TYPE),
      inArray(jobs.repositoryId, [ ...repositoryIds ]),
      inArray(jobs.status, [ 'queued', 'running' ])
    ))
    .all();
  return new Map(rows.flatMap(row =>
    row.repositoryId === null ? [] : [
      [
        row.repositoryId,
        {
          jobId: row.id,
          state: row.status === 'running' ? 'running' : 'waiting',
          percent: row.status === 'running' ? row.progress : null
        } satisfies CloneProgress
      ] as const
    ]
  ));
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
