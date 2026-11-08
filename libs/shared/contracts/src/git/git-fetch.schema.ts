import { z } from 'zod';
import { GIT_PATH_MAX_LENGTH } from './git-paths.schema';

/** A fetch that ran (GA-33): whether any remote branch moved, and whether the current branch's upstream did. */
export const GitFetchedSchema = z
  .object({
    kind: z.literal('fetched'),
    moved: z.boolean(),
    /** Its commit changed, or it was created or deleted; false on a branch without an upstream. */
    upstreamMoved: z.boolean()
  })
  .meta({ id: 'GitFetched' });

/** What the current branch's upstream has that the branch does not, as of the last fetch (GA-34). */
export const GitIncomingChangesSchema = z
  .object({
    /** Such as `origin/main`. */
    upstream: z.string(),
    commits: z.number().int().min(0),
    /** Those commits change the path that was asked about; false without a path. */
    touchesPath: z.boolean()
  })
  .meta({ id: 'GitIncomingChanges' });

/**
 * `incoming` is `null` on a detached `HEAD`, before the first commit, and
 * without an upstream or with one that is gone.
 */
export const GitIncomingSchema = z
  .object({ incoming: GitIncomingChangesSchema.nullable() })
  .meta({ id: 'GitIncoming' });

/** An optional file of the working copy, as in the files API, to ask whether the incoming commits change it. */
export const GitIncomingQuerySchema = z
  .object({ path: z.string().min(1).max(GIT_PATH_MAX_LENGTH).optional() })
  .meta({ id: 'GitIncomingQuery' });

export type GitFetched = z.infer<typeof GitFetchedSchema>;
export type GitIncomingChanges = z.infer<typeof GitIncomingChangesSchema>;
export type GitIncoming = z.infer<typeof GitIncomingSchema>;
export type GitIncomingQuery = z.infer<typeof GitIncomingQuerySchema>;
