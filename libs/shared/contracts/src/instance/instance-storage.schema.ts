import { z } from 'zod';

/** The server's storage, for the administrators' low-space banner (NF-9.7). */
export const InstanceStorageSchema = z
  .object({
    /** Whether free space is below the low-space threshold, so new clones are refused. */
    low: z.boolean()
  })
  .meta({ id: 'InstanceStorage' });

export type InstanceStorage = z.infer<typeof InstanceStorageSchema>;
