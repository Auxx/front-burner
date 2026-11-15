import { z } from 'zod';
import { nullableString } from '../nullable-string';
import { CLONE_MODES, GIT_LEVELS, RepositorySummarySchema } from './repository-summary.schema';

/**
 * What the repository's settings page shows that a list entry does not
 * (RM-9, RM-10, RM-16). A separate response, so that the lists do not carry
 * git's error text. `branch` is the cloned branch of a single-branch clone;
 * `errorDetail` and `errorRequestId` are set only in the `error` status, and
 * `errorDetail` is null when nothing ran git, such as after a timeout.
 */
export const RepositoryDetailsSchema = z
  .object({
    summary: RepositorySummarySchema,
    cloneMode: z.enum(CLONE_MODES),
    branch: nullableString(),
    gitLevel: z.enum(GIT_LEVELS),
    addedAt: z.iso.datetime(),
    errorDetail: nullableString(),
    errorRequestId: nullableString()
  })
  .meta({ id: 'RepositoryDetails' });

export type RepositoryDetails = z.infer<typeof RepositoryDetailsSchema>;
