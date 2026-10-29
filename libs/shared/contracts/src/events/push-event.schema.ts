import { z } from 'zod';
import { REPOSITORY_ERRORS, REPOSITORY_STATUSES } from '../repositories/repository-summary.schema';

/**
 * A notification on the push channel (A-3.10, A-3.11). Events are small and
 * never replayed: after every (re)connect, clients fetch current state over
 * REST. Not part of the OpenAPI document, so there is no `.meta` id.
 */
export const PushEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('repository.status'),
    repositoryId: z.number().int(),
    status: z.enum(REPOSITORY_STATUSES),
    error: z.enum(REPOSITORY_ERRORS).nullable()
  }),
  z.object({
    type: z.literal('job.progress'),
    jobId: z.number().int(),
    percent: z.number().int().min(0).max(100)
  }),
  z.object({
    type: z.literal('job.finished'),
    jobId: z.number().int(),
    outcome: z.enum([ 'done', 'failed', 'cancelled' ])
  }),
  /**
   * The folders whose entries changed (`''` is the root), or `all` after a
   * change to many (FB-41). After a save or a recreate, `files` names the
   * files whose new content hash is known, so that a client can tell its own
   * saves from changes made elsewhere (A-3.11, ED-24).
   */
  z.object({
    type: z.literal('files.changed'),
    repositoryId: z.number().int(),
    folders: z.union([ z.array(z.string()), z.literal('all') ]),
    files: z.array(z.object({ path: z.string(), hash: z.string() })).optional()
  })
]);

export type PushEvent = z.infer<typeof PushEventSchema>;
export type PushEventType = PushEvent['type'];
