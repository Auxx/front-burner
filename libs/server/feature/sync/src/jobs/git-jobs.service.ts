import { DATABASE, Database, Job, jobs } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import {
  ERROR_CODES,
  GitJobOutcome,
  GitJobOutcomeSchema,
  GitJobState,
  GitNetworkJob,
  GitNetworkJobType
} from '@front-burner/shared-contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';

const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

/**
 * The job types that clients read as git jobs, each with the name clients see.
 * Jobs of a type that is not in it are not served.
 */
export const GIT_JOB_TYPES: Readonly<Record<string, GitNetworkJobType>> = { 'sync.push': 'push' };

/**
 * What a client reads about a repository's git jobs (GA-1, GA-9, GA-29): the
 * state of one job, and the unfinished network job.
 */
@Injectable()
export class GitJobs {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * One of the repository's git jobs. Another user's job, one of another
   * repository, or one of a type that is not a git job is answered like a
   * missing one (GA-1).
   */
  state(userId: number, repositoryId: number, jobId: number): GitJobState {
    const job = this.database.db.select().from(jobs).where(and(
      eq(jobs.id, jobId),
      eq(jobs.userId, userId),
      eq(jobs.repositoryId, repositoryId),
      inArray(jobs.type, Object.keys(GIT_JOB_TYPES))
    )).get();
    // The job's user and repository match, so the repository is the user's.
    if (job === undefined) {
      throw new ApiErrorException(404, 'not-found');
    }
    return { status: job.status, outcome: outcomeOf(job) };
  }

  /** The repository's unfinished network job, so that a reloaded page can follow it (GA-9). */
  networkJob(userId: number, repositoryId: number): GitNetworkJob | null {
    const job = this.database.db.select({ id: jobs.id, type: jobs.type }).from(jobs).where(and(
      eq(jobs.userId, userId),
      eq(jobs.repositoryId, repositoryId),
      inArray(jobs.type, Object.keys(GIT_JOB_TYPES)),
      inArray(jobs.status, [ 'queued', 'running' ])
    )).orderBy(desc(jobs.id)).get();
    return job === undefined ? null : { id: job.id, type: GIT_JOB_TYPES[job.type] };
  }
}

/**
 * A finished job's outcome. A job the runner failed, such as one a restart
 * interrupted, has its error code and no params; a code without text is
 * reported as `internal`.
 */
function outcomeOf(job: Job): GitJobOutcome | null {
  if (job.status === 'done') {
    return job.result === null ? null : GitJobOutcomeSchema.parse(JSON.parse(job.result));
  }
  if (job.status === 'failed') {
    const code = job.errorCode !== null && KNOWN_CODES.has(job.errorCode) ? job.errorCode : 'internal';
    return { kind: 'failed', code, params: {} };
  }
  return null;
}
