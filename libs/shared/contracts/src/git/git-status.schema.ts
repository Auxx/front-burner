import { z } from 'zod';
import { GitNetworkJobSchema } from './git-push.schema';

export const GIT_CHANGE_STATES = [ 'modified', 'added', 'deleted' ] as const;
export type GitChangeState = (typeof GIT_CHANGE_STATES)[number];

export const GitChangeSchema = z
  .object({
    path: z.string(),
    state: z.enum(GIT_CHANGE_STATES)
  })
  .meta({ id: 'GitChange' });

/** The current branch's last commit (GA-22). */
export const GitLastCommitSchema = z
  .object({
    /** Which commit this is, so that a client can tell when it was replaced. */
    oid: z.string(),
    /** It is on the current branch, not on any remote branch, and not a merge commit. */
    amendable: z.boolean(),
    /** Without a trailing line break; `null` unless it can be amended, as nothing else needs it. */
    message: z.string().nullable()
  })
  .meta({ id: 'GitLastCommit' });

/** A working copy's branch, its counts against the upstream, and every changed file (GA-7, GA-11, GA-42). */
export const GitStatusSchema = z
  .object({
    /** `null` on a detached `HEAD`. */
    branch: z.string().nullable(),
    /** No commit yet: `branch` is `main` (GA-42). */
    noCommits: z.boolean(),
    /** For example `origin/main`; `null` for an unpublished branch, or one whose upstream is gone from the remote. */
    upstream: z.string().nullable(),
    /** **To push**, as of the last fetch. */
    ahead: z.number().int().min(0),
    /** **To pull**, as of the last fetch. */
    behind: z.number().int().min(0),
    /** Sorted by path, comparing code units. */
    changes: z.array(GitChangeSchema),
    mergeInProgress: z.boolean(),
    /** `null` without commits. */
    lastCommit: GitLastCommitSchema.nullable(),
    /** The unfinished push, or `null` (GA-9). */
    networkJob: GitNetworkJobSchema.nullable()
  })
  .meta({ id: 'GitStatus' });

export type GitChange = z.infer<typeof GitChangeSchema>;
export type GitLastCommit = z.infer<typeof GitLastCommitSchema>;
export type GitStatus = z.infer<typeof GitStatusSchema>;
