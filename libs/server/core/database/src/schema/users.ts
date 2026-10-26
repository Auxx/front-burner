import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Accounts of the instance (A-4.4). Columns that later features need (OIDC
 * issuer and subject, the disabled flag, allowed git control levels) are added
 * as nullable or defaulted columns, so no row has to be rewritten.
 */
export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** The username of a password user; unique ignoring case. */
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: [ 'administrator', 'user' ] }).notNull(),
    loginMethod: text('login_method', { enum: [ 'password', 'oidc' ] }).notNull(),
    /** Argon2id (PP-12); null for OIDC users. */
    passwordHash: text('password_hash'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  table => [ uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`) ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
