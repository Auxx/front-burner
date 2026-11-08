import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { repositories } from './repositories';

/** What the backend remembers about a repository's synchronisation (A-4.2). More columns arrive with their features. */
export const syncState = sqliteTable('sync_state', {
  repositoryId: integer('repository_id').primaryKey().references(() => repositories.id, { onDelete: 'cascade' }),
  /** JSON `{ code, params }` of the last fetch's problem; `null` when it had none. */
  fetchProblem: text('fetch_problem'),
  /** The commit the branch was at just before the last merge (D-4.6, A-4.5a); `null` when none is recorded. */
  recordedCommit: text('recorded_commit'),
  /** The merge commit that the recorded commit belongs to; `null` until the merge is committed. */
  mergeCommit: text('merge_commit'),
  /** The record of the merge before the one being applied, kept to restore if that merge fails or is undone. */
  earlierRecordedCommit: text('earlier_recorded_commit'),
  earlierMergeCommit: text('earlier_merge_commit'),
  /** True while a merge is being applied, so that a restart can tell it was interrupted. */
  mergeApplying: integer('merge_applying', { mode: 'boolean' }).notNull().default(false)
});

export type SyncState = typeof syncState.$inferSelect;
