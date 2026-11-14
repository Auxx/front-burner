import { z } from 'zod';
import { RepositorySummarySchema } from './repository-summary.schema';

/**
 * All of the user's repositories, in every status, by name ignoring case
 * (RM-5). Not paged and without a `.max`: a user is expected to have about 50
 * (NF-1.3), a scale target that adding does not enforce.
 */
export const RepositoryListSchema = z
  .object({ repositories: z.array(RepositorySummarySchema) })
  .meta({ id: 'RepositoryList' });

export type RepositoryList = z.infer<typeof RepositoryListSchema>;
