import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './users';

/** The reason codes of LG-43, in its table's order. */
export const LOGIN_AUDIT_REASONS = [
  'success',
  'unknown-email',
  'wrong-password',
  'not-password-user',
  'onboarding-not-finished',
  'user-disabled',
  'rate-limited',
  'provider-error',
  'provider-unreachable',
  'code-exchange-failed',
  'state-mismatch',
  'invalid-id-token',
  'email-not-verified',
  'registration-disabled',
  'password-user',
  'admin-email-mismatch',
  'refresh-token-reused'
] as const;

export type LoginAuditReason = (typeof LOGIN_AUDIT_REASONS)[number];

/** Every login attempt and refresh token reuse (LG-41, LG-42); never a secret (LG-44). */
export const loginAudit = sqliteTable(
  'login_audit',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
    method: text('method', { enum: [ 'password', 'oidc' ] }).notNull(),
    outcome: text('outcome', { enum: [ 'success', 'failure' ] }).notNull(),
    reason: text('reason', { enum: LOGIN_AUDIT_REASONS }).notNull(),
    /** As entered (trimmed), or from the ID token. */
    email: text('email'),
    issuer: text('issuer'),
    subject: text('subject'),
    providerError: text('provider_error'),
    providerErrorDescription: text('provider_error_description'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    sessionId: text('session_id'),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' })
  },
  table => [ index('login_audit_at').on(table.at) ]
);

export type LoginAuditEntry = typeof loginAudit.$inferSelect;
export type NewLoginAuditEntry = typeof loginAudit.$inferInsert;
