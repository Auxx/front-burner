import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users';

/**
 * One login of one user on one client (LG-30). Only a hash of the current
 * refresh token is stored; `expiresAt` is fixed at login (LG-29).
 */
export const sessions = sqliteTable(
  'sessions',
  {
    /** Random, base64url; also the first part of the refresh token. */
    id: text('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    loginMethod: text('login_method', { enum: [ 'password', 'oidc' ] }).notNull(),
    refreshTokenDelivery: text('refresh_token_delivery', { enum: [ 'cookie', 'body' ] }).notNull(),
    /** SHA-256 hex of the current refresh token. */
    refreshTokenHash: text('refresh_token_hash').notNull(),
    /** The `jti` of the newest auth token. */
    authTokenId: text('auth_token_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
  },
  table => [ index('sessions_user_id').on(table.userId) ]
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
