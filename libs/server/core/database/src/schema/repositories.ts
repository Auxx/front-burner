import type { CloneMode, GitLevel, RepositoryError, RepositoryStatus } from '@front-burner/shared-contracts';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { savedCredentials } from './saved-credentials';
import { users } from './users';

// drizzle-kit loads this file without the workspace's path aliases, so only a
// type may come from the contracts; a test checks that the lists agree.
export const CLONE_MODES = [ 'full', 'single-branch' ] as const satisfies readonly CloneMode[];
export const GIT_LEVELS = [ 'simple', 'guided', 'advanced' ] as const satisfies readonly GitLevel[];
/** "Needs your confirmation" is not stored: adding on a user's behalf is not in the MVP. */
export const REPOSITORY_STATUS_VALUES = [ 'cloning', 'ready', 'error' ] as const satisfies readonly RepositoryStatus[];
export const REPOSITORY_ERROR_VALUES = [
  'clone-failed',
  'clone-timed-out',
  'working-copy-missing'
] as const satisfies readonly RepositoryError[];

/** A user's working copy of a remote (REQ-REPO-001, A-4.4). */
export const repositories = sqliteTable(
  'repositories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Unique among the user's repositories, ignoring case (AR-15). */
    name: text('name').notNull(),
    remoteUrl: text('remote_url').notNull(),
    /**
     * The saved credentials git uses; null for a public repository. Credentials
     * outlive repositories, and deleting them leaves the repository without
     * (A-4.5b).
     */
    credentialId: integer('credential_id').references(() => savedCredentials.id, { onDelete: 'set null' }),
    cloneMode: text('clone_mode', { enum: CLONE_MODES }).notNull(),
    /** The cloned branch of a single-branch clone; null for a full clone. */
    branch: text('branch'),
    gitLevel: text('git_level', { enum: GIT_LEVELS }).notNull(),
    status: text('status', { enum: REPOSITORY_STATUS_VALUES }).notNull(),
    /** Set only in the `error` status (RM-6). */
    errorCode: text('error_code', { enum: REPOSITORY_ERROR_VALUES }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    /** DS-6 to DS-9. */
    lastAccessedAt: integer('last_accessed_at', { mode: 'timestamp_ms' }).notNull()
  },
  table => [
    uniqueIndex('repositories_user_name_unique').on(table.userId, sql`lower(${table.name})`),
    index('repositories_user_last_accessed').on(table.userId, table.lastAccessedAt)
  ]
);

export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;
