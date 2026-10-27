import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users } from './users';

export const JOB_STATUSES = [ 'queued', 'running', 'done', 'failed', 'cancelled' ] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * A background job (A-6.1). Payloads and results are JSON and never contain a
 * secret (A-6.3).
 */
export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type').notNull(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    payload: text('payload').notNull().default('{}'),
    status: text('status', { enum: JOB_STATUSES }).notNull(),
    runAt: integer('run_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    attempts: integer('attempts').notNull().default(0),
    progress: integer('progress'),
    result: text('result'),
    errorCode: text('error_code'),
    dedupeKey: text('dedupe_key')
  },
  table => [
    // One unfinished job per dedupe key (A-6.2).
    uniqueIndex('jobs_dedupe_unfinished').on(table.dedupeKey).where(sql`status IN ('queued', 'running')`),
    index('jobs_status_run_at').on(table.status, table.runAt)
  ]
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
