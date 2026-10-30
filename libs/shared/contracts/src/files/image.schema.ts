import { z } from 'zod';

/** The largest image the API serves, in bytes: 10 MB (IM-9). */
export const IMAGE_SIZE_LIMIT = 10_485_760;

/** The repository image to serve, by its path in the working copy (IM-7). */
export const ImageQuerySchema = z.object({ path: z.string().max(4096) }).meta({ id: 'ImageQuery' });

export type ImageQuery = z.infer<typeof ImageQuerySchema>;
