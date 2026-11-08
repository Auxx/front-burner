import { z } from 'zod';
import { GitFetchedSchema } from './git-fetch.schema';

/** A git operation started as a job (GA-3, A-3.2); follow it with `job.finished` and the job's state. */
export const GitJobStartedSchema = z.object({ jobId: z.number().int().positive() }).meta({ id: 'GitJobStarted' });

export const GIT_JOB_STATUSES = [ 'queued', 'running', 'done', 'failed', 'cancelled' ] as const;
export type GitJobStatus = (typeof GIT_JOB_STATUSES)[number];

/** The kinds of network job a repository runs one at a time (A-5.3). */
export const GIT_NETWORK_JOB_TYPES = [ 'push', 'fetch' ] as const;
export type GitNetworkJobType = (typeof GIT_NETWORK_JOB_TYPES)[number];

/** A successful push (GA-32). */
export const GitPushedSchema = z
  .object({
    kind: z.literal('pushed'),
    /** The commits the remote did not have yet. */
    commits: z.number().int().min(0),
    /** Such as `origin/main`. */
    upstream: z.string()
  })
  .meta({ id: 'GitPushed' });

/**
 * A git operation that did not succeed: an error code with text under
 * `errors.<code>`, and its values. A push refused by the remote carries the
 * remote's own lines in `remoteMessages`, as plain text (GA-31).
 */
export const GitJobFailedSchema = z
  .object({
    kind: z.literal('failed'),
    code: z.string(),
    params: z.record(z.string(), z.string())
  })
  .meta({ id: 'GitJobFailed' });

export const GitJobOutcomeSchema = z
  .discriminatedUnion('kind', [ GitPushedSchema, GitFetchedSchema, GitJobFailedSchema ])
  .meta({ id: 'GitJobOutcome' });

/** How a git job stands; `outcome` once it has ended, `null` before and when it was cancelled. */
export const GitJobStateSchema = z
  .object({
    status: z.enum(GIT_JOB_STATUSES),
    outcome: GitJobOutcomeSchema.nullable()
  })
  .meta({ id: 'GitJobState' });

/** The repository's unfinished network job, a push or a fetch, so that a reloaded page or another tab can follow it (GA-9). */
export const GitNetworkJobSchema = z
  .object({
    id: z.number().int().positive(),
    type: z.enum(GIT_NETWORK_JOB_TYPES)
  })
  .meta({ id: 'GitNetworkJob' });

/** A repository's git job, in the path. */
export const GitJobParamsSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    jobId: z.coerce.number().int().positive()
  })
  .meta({ id: 'GitJobParams' });

export type GitJobParams = z.infer<typeof GitJobParamsSchema>;
export type GitJobStarted = z.infer<typeof GitJobStartedSchema>;
export type GitPushed = z.infer<typeof GitPushedSchema>;
export type GitJobFailed = z.infer<typeof GitJobFailedSchema>;
export type GitJobOutcome = z.infer<typeof GitJobOutcomeSchema>;
export type GitJobState = z.infer<typeof GitJobStateSchema>;
export type GitNetworkJob = z.infer<typeof GitNetworkJobSchema>;
