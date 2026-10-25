import { z } from 'zod';

/** One invalid field of a request, with a code the client translates. */
export const FieldErrorSchema = z
  .object({
    path: z.string(),
    code: z.string(),
    params: z.record(z.string(), z.unknown())
  })
  .meta({ id: 'FieldError' });

/**
 * The body of every error response (A-3.3). `code` is a plain string rather
 * than `ErrorCode`, so that clients accept codes newer than themselves.
 */
export const ApiErrorSchema = z
  .object({
    code: z.string(),
    params: z.record(z.string(), z.unknown()),
    requestId: z.string(),
    message: z.string(),
    fields: z.array(FieldErrorSchema).optional()
  })
  .meta({ id: 'ApiError' });

export type FieldError = z.infer<typeof FieldErrorSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
