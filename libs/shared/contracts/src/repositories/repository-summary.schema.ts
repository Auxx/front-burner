import { z } from 'zod';

/**
 * The statuses of a repository (DS terms, RM-6). `needs-confirmation` is never
 * produced in the MVP, but clients handle it (DS-21).
 */
export const REPOSITORY_STATUSES = [ 'needs-confirmation', 'cloning', 'ready', 'error' ] as const;

/** Why a repository in the `error` status cannot be opened (RM-6). */
export const REPOSITORY_ERRORS = [ 'clone-failed', 'clone-timed-out', 'working-copy-missing' ] as const;

/** Problems that leave a repository openable (RM-8). */
export const REPOSITORY_WARNINGS = [ 'credentials-refused', 'cannot-push', 'host-key-changed', 'key-locked' ] as const;

/** How a repository is cloned (AR-33 to AR-37). */
export const CLONE_MODES = [ 'full', 'single-branch' ] as const;

/** The git control levels. */
export const GIT_LEVELS = [ 'simple', 'guided', 'advanced' ] as const;

export type RepositoryStatus = (typeof REPOSITORY_STATUSES)[number];
export type RepositoryError = (typeof REPOSITORY_ERRORS)[number];
export type RepositoryWarning = (typeof REPOSITORY_WARNINGS)[number];
export type CloneMode = (typeof CLONE_MODES)[number];
export type GitLevel = (typeof GIT_LEVELS)[number];

/**
 * The clone of a `cloning` repository (RM-7, DS-23): `waiting` while the job
 * waits its turn (AR-52), then `running`, with git's last reported percentage,
 * `null` before the first. `jobId` ties the `job.progress` events to it.
 */
export const CloneProgressSchema = z
  .object({
    jobId: z.number().int(),
    state: z.enum([ 'waiting', 'running' ]),
    percent: z.number().int().min(0).max(100).nullable()
  })
  .meta({ id: 'CloneProgress' });

/**
 * One entry of a repository list (DS-18); `remote` is the display form, without
 * credentials (DS-19). `clone` is set only while the repository is `cloning`
 * and its clone job has not ended.
 */
export const RepositorySummarySchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    remote: z.string(),
    status: z.enum(REPOSITORY_STATUSES),
    error: z.enum(REPOSITORY_ERRORS).nullable(),
    warnings: z.array(z.enum(REPOSITORY_WARNINGS)),
    clone: CloneProgressSchema.nullable(),
    lastAccessedAt: z.iso.datetime()
  })
  .meta({ id: 'RepositorySummary' });

/** The dashboard's list: at most 10, most recent first (DS-16, DS-17). */
export const RecentRepositoriesSchema = z
  .object({ repositories: z.array(RepositorySummarySchema).max(10) })
  .meta({ id: 'RecentRepositories' });

/** Leaves one repository out of the recent list, such as the current one (NV-10). */
export const RecentQuerySchema = z
  .object({ exclude: z.coerce.number().int().positive().optional() })
  .meta({ id: 'RecentQuery' });

export type CloneProgress = z.infer<typeof CloneProgressSchema>;
export type RepositorySummary = z.infer<typeof RepositorySummarySchema>;
export type RecentRepositories = z.infer<typeof RecentRepositoriesSchema>;
export type RecentQuery = z.infer<typeof RecentQuerySchema>;

/** The `:id` of every `/repositories/:id` route. */
export const RepositoryParamsSchema = z
  .object({ id: z.coerce.number().int().positive() })
  .meta({ id: 'RepositoryParams' });

export type RepositoryParams = z.infer<typeof RepositoryParamsSchema>;
