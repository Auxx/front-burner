import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { repositories } from './repositories';

/** What the backend remembers about a repository's synchronisation (A-4.2). More columns arrive with their features. */
export const syncState = sqliteTable('sync_state', {
  repositoryId: integer('repository_id').primaryKey().references(() => repositories.id, { onDelete: 'cascade' }),
  /** JSON `{ code, params }` of the last fetch's problem; `null` when it had none. */
  fetchProblem: text('fetch_problem')
});

export type SyncState = typeof syncState.$inferSelect;
