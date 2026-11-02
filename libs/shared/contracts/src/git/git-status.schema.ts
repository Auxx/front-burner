import { z } from 'zod';

export const GIT_CHANGE_STATES = [ 'modified', 'added', 'deleted' ] as const;
export type GitChangeState = (typeof GIT_CHANGE_STATES)[number];

export const GitChangeSchema = z
  .object({
    path: z.string(),
    state: z.enum(GIT_CHANGE_STATES)
  })
  .meta({ id: 'GitChange' });

/** A working copy's branch, its counts against the upstream, and every changed file (GA-7, GA-11, GA-42). */
export const GitStatusSchema = z
  .object({
    /** `null` on a detached `HEAD`. */
    branch: z.string().nullable(),
    /** No commit yet: `branch` is `main` (GA-42). */
    noCommits: z.boolean(),
    /** For example `origin/main`; `null` for an unpublished branch. */
    upstream: z.string().nullable(),
    /** **To push**, as of the last fetch. */
    ahead: z.number().int().min(0),
    /** **To pull**, as of the last fetch. */
    behind: z.number().int().min(0),
    /** Sorted by path, comparing code units. */
    changes: z.array(GitChangeSchema),
    mergeInProgress: z.boolean()
  })
  .meta({ id: 'GitStatus' });

export type GitChange = z.infer<typeof GitChangeSchema>;
export type GitStatus = z.infer<typeof GitStatusSchema>;
