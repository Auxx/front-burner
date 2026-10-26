import { z } from 'zod';

export const USER_ROLES = [ 'administrator', 'user' ] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** The user of the auth token. */
export const CurrentUserSchema = z
  .object({
    id: z.number().int(),
    email: z.string(),
    displayName: z.string(),
    role: z.enum(USER_ROLES)
  })
  .meta({ id: 'CurrentUser' });

export type CurrentUser = z.infer<typeof CurrentUserSchema>;
