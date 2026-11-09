import { z } from 'zod';
import { nullableString } from '../nullable-string';

export const GitLocalBranchSchema = z
  .object({
    name: z.string(),
    /** Such as `origin/main`; `null` for an unpublished branch. */
    upstream: nullableString()
  })
  .meta({ id: 'GitLocalBranch' });

export const GitRemoteBranchSchema = z
  .object({
    /** Such as `origin/feature`. */
    name: z.string(),
    /** Such as `feature`: the name that a local branch of it would have (GA-37). */
    branch: z.string()
  })
  .meta({ id: 'GitRemoteBranch' });

/** The branches of a working copy, as of the last fetch, sorted by name, comparing code units (GA-36). */
export const GitBranchListSchema = z
  .object({
    /**
     * `null` on a detached `HEAD`, and on a branch whose name is not valid UTF-8,
     * which no list has. Before the first commit it is `main`, which is listed in
     * `local` (GA-42).
     */
    current: nullableString(),
    local: z.array(GitLocalBranchSchema),
    /** The branches of `origin` that no local branch has the name of or tracks. */
    remote: z.array(GitRemoteBranchSchema),
    /** A single-branch clone, whose remote branches are only the cloned one and those pushed from here (GA-41). */
    singleBranch: z.boolean()
  })
  .meta({ id: 'GitBranchList' });

export type GitLocalBranch = z.infer<typeof GitLocalBranchSchema>;
export type GitRemoteBranch = z.infer<typeof GitRemoteBranchSchema>;
export type GitBranchList = z.infer<typeof GitBranchListSchema>;
