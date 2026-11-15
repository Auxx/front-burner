import { z } from 'zod';

/**
 * What removing a repository would lose, for the remove dialog (RM-18).
 * `uncommittedFiles` counts untracked files but not ignored ones, and
 * `unpushedCommits` the commits on `HEAD` or any local branch that no remote
 * branch has, as of the last fetch. `stashes` counts the entries of
 * `git stash list`. `unreadable` is true when git could not read the working
 * copy: nothing then proves that there is nothing to lose, and the counts are 0.
 */
export const RemovalCheckResultSchema = z
  .object({
    uncommittedFiles: z.number().int().nonnegative(),
    unpushedCommits: z.number().int().nonnegative(),
    stashes: z.number().int().nonnegative(),
    mergeInProgress: z.boolean(),
    unreadable: z.boolean()
  })
  .meta({ id: 'RemovalCheckResult' });

export type RemovalCheckResult = z.infer<typeof RemovalCheckResultSchema>;

/**
 * The query of `DELETE /repositories/:id`: the name the user typed, needed
 * only when removing would lose work (RM-18). A query, as a `DELETE` body is
 * not portable.
 */
export const RemoveRepositoryQuerySchema = z
  .object({ confirmName: z.string().max(1000).optional() })
  .meta({ id: 'RemoveRepositoryQuery' });

export type RemoveRepositoryQuery = z.infer<typeof RemoveRepositoryQuerySchema>;

/** Whether `typed` confirms removing the repository named `name`: exactly its name, spaces around it trimmed. */
export const confirmsName = (name: string, typed: string | undefined): boolean => typed?.trim() === name;

/** Whether removing would lose work, so that the user must type the repository name (RM-18). */
export const wouldLoseWork = (check: RemovalCheckResult): boolean =>
  check.uncommittedFiles > 0 || check.unpushedCommits > 0 || check.stashes > 0 || check.mergeInProgress
  || check.unreadable;
