import { z } from 'zod';

/** Long enough for any message a person writes, short enough to keep a request small. _(Plan 52's call.)_ */
export const COMMIT_MESSAGE_MAX_LENGTH = 65_536;

/**
 * As many paths as fit, with long names, in the server's 2 MB limit on a
 * request body. _(Plan 52's call.)_
 */
export const COMMIT_MAX_PATHS = 10_000;

/** GA-19: a commit needs at least one path, and amending needs none. */
export const hasPathsUnlessAmending = (request: { paths: string[]; amend?: boolean | undefined; }): boolean =>
  request.amend === true || request.paths.length > 0;

/**
 * Commits exactly `paths` (GA-19). The message is kept as written: git removes
 * only trailing spaces and trailing blank lines (GA-21). A long first line is
 * not refused (GA-18), and neither is a line starting with `#`.
 */
export const CommitRequestSchema = z
  .object({
    message: z
      .string()
      .max(COMMIT_MESSAGE_MAX_LENGTH)
      .refine(message => message.trim().length > 0, { message: 'Enter a commit message' }),
    /** Paths of changes; others are ignored. At least one, unless amending. */
    paths: z.array(z.string()).max(COMMIT_MAX_PATHS),
    /** Replaces the last commit, which must be one that can be amended (GA-22). */
    amend: z.boolean().optional()
  })
  .refine(hasPathsUnlessAmending, { path: [ 'paths' ], message: 'Select at least one file' })
  .meta({ id: 'CommitRequest' });

export const CommitResultSchema = z
  .object({
    /** The new commit's object name. */
    oid: z.string()
  })
  .meta({ id: 'CommitResult' });

export type CommitRequest = z.infer<typeof CommitRequestSchema>;
export type CommitResult = z.infer<typeof CommitResultSchema>;
