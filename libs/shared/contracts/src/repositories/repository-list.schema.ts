import { z } from 'zod';
import { RepositorySummarySchema } from './repository-summary.schema';

/**
 * All of the user's repositories, in every status, by name ignoring case
 * (RM-5). Not paged and without a `.max`: adding keeps a user to at most 50
 * (NF-1.3).
 */
export const RepositoryListSchema = z
  .object({ repositories: z.array(RepositorySummarySchema) })
  .meta({ id: 'RepositoryList' });

export type RepositoryList = z.infer<typeof RepositoryListSchema>;
