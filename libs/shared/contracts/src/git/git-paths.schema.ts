import { z } from 'zod';

/**
 * As many paths as fit, at about 190 characters each, in the server's 2 MB limit
 * on a request body. A client sends a longer list in several requests.
 */
export const GIT_PATHS_MAX = 10_000;
/** As `GitDiffQuerySchema`. */
export const GIT_PATH_MAX_LENGTH = 4096;

/**
 * The files of a git action, such as a discard: always the paths the client
 * showed, so that a change that arrived a moment ago is left alone. Paths that
 * are not changes are ignored.
 */
export const GitPathsSchema = z
  .object({
    paths: z.array(z.string().min(1).max(GIT_PATH_MAX_LENGTH)).min(1).max(GIT_PATHS_MAX)
  })
  .meta({ id: 'GitPaths' });

export type GitPaths = z.infer<typeof GitPathsSchema>;
