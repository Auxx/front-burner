import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Tx } from '../database/open-database';
import { users } from './users';

/**
 * User-level preferences (A-4.4, REQ-REPO-007).
 *
 * Each user has one row, created in the same transaction as the account.
 */
export const userPreferences = sqliteTable('user_preferences', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  commitAuthorName: text('commit_author_name').notNull(),
  commitAuthorEmail: text('commit_author_email').notNull(),
  commitAuthorConfirmed: integer('commit_author_confirmed', { mode: 'boolean' })
    .notNull()
    .default(false)
});

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;

/**
 * Inserts the default preferences for a newly created user (CA-7).
 */
export function insertUserPreferences(
  tx: Tx,
  user: { id: number; displayName: string; email: string; }
): void {
  tx.insert(userPreferences).values({
    userId: user.id,
    commitAuthorName: user.displayName,
    commitAuthorEmail: user.email,
    commitAuthorConfirmed: false
  }).run();
}
