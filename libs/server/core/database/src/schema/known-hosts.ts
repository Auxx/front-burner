import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';

/** SSH host keys a user has trusted (AR-32, A-5.6). */
export const knownHosts = sqliteTable(
  'known_hosts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** Lower case. */
    host: text('host').notNull(),
    port: integer('port').notNull(),
    /** As `ssh` names it, for example `ssh-ed25519`. */
    keyType: text('key_type').notNull(),
    /** Base64; `ssh` needs the key, not only its fingerprint. */
    publicKey: text('public_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  table => [
    uniqueIndex('known_hosts_user_host_port_type_unique').on(table.userId, table.host, table.port, table.keyType)
  ]
);

export type KnownHost = typeof knownHosts.$inferSelect;
