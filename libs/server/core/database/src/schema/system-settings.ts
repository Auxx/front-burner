import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Instance-wide settings managed by administrators (A-4.4); one row. */
export const systemSettings = sqliteTable(
  'system_settings',
  {
    id: integer('id').primaryKey(),
    /** Anyone the OIDC provider authenticates gets an account on first login (LG-18). */
    automaticRegistration: integer('automatic_registration', { mode: 'boolean' }).notNull().default(false),
    /** OIDC settings saved on the onboarding page; the environment wins over them (AO-35). */
    oidcIssuer: text('oidc_issuer'),
    oidcClientId: text('oidc_client_id'),
    /** Encrypted with the binding `{ table: 'system_settings', recordId: 1 }` (A-4.8). */
    oidcClientSecret: text('oidc_client_secret'),
    oidcScopes: text('oidc_scopes'),
    oidcRequireVerifiedEmail: integer('oidc_require_verified_email', { mode: 'boolean' })
  },
  table => [ check('system_settings_single_row', sql`${table.id} = 1`) ]
);

export type SystemSettings = typeof systemSettings.$inferSelect;
