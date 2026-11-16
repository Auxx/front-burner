import { z } from 'zod';
import { GitProblemStateSchema } from '../git/git-status.schema';
import { nullableString } from '../nullable-string';
import { CLONE_MODES, GIT_LEVELS, RepositorySummarySchema } from './repository-summary.schema';

/**
 * The problems that the operations with the remote left, which the warnings
 * of RM-8 come from, with what their fixes need, such as the new host key of
 * "Server identity changed" (RC-21). Their params never hold a secret.
 */
export const RemoteProblemsSchema = z
  .object({
    /** Of the last fetch or pull that had one; `null` when there is none. */
    fetch: GitProblemStateSchema.nullable(),
    /** Of the last push that had one; `null` when there is none. */
    push: GitProblemStateSchema.nullable()
  })
  .meta({ id: 'RemoteProblems' });

export type RemoteProblems = z.infer<typeof RemoteProblemsSchema>;

/**
 * What the repository's settings page shows that a list entry does not
 * (RM-9, RM-10, RM-16). A separate response, so that the lists do not carry
 * git's error text. `branch` is the cloned branch of a single-branch clone;
 * `errorDetail` and `errorRequestId` are set only in the `error` status, and
 * `errorDetail` is null when nothing ran git, such as after a timeout.
 * `remoteProblems` are the stored problems of a `ready` repository, both
 * `null` in any other status, as its warnings are (RM-8).
 */
export const RepositoryDetailsSchema = z
  .object({
    summary: RepositorySummarySchema,
    cloneMode: z.enum(CLONE_MODES),
    branch: nullableString(),
    gitLevel: z.enum(GIT_LEVELS),
    addedAt: z.iso.datetime(),
    errorDetail: nullableString(),
    errorRequestId: nullableString(),
    remoteProblems: RemoteProblemsSchema
  })
  .meta({ id: 'RepositoryDetails' });

export type RepositoryDetails = z.infer<typeof RepositoryDetailsSchema>;
