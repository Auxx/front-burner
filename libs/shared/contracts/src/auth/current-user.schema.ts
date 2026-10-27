import { z } from 'zod';
import { GIT_LEVELS } from '../repositories/repository-summary.schema';

export const USER_ROLES = [ 'administrator', 'user' ] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** The user of the auth token. */
export const CurrentUserSchema = z
  .object({
    id: z.number().int(),
    email: z.string(),
    displayName: z.string(),
    role: z.enum(USER_ROLES),
    /** The git control levels the user may choose, in the order Simple, Guided, Advanced (AR-38). */
    allowedGitLevels: z.array(z.enum(GIT_LEVELS))
  })
  .meta({ id: 'CurrentUser' });

export type CurrentUser = z.infer<typeof CurrentUserSchema>;
