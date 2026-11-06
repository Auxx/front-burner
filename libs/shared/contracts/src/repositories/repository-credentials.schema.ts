import { z } from 'zod';
import {
  NewHttpsCredentialsSchema,
  SavedHttpsCredentialsSchema,
  SavedSshKeySchema
} from '../credentials/credentials.schema';

/**
 * The credentials a repository uses, for the repository credentials dialog
 * and the locked-key banner (RC-7, RC-12, RC-15, RC-16). Public parts only
 * (A-3.5). `protocol` is the remote's, which the dialog cannot change (RC-7);
 * `inUse` is null for a repository without credentials. `usedBy` counts the
 * user's repositories that use the same credentials, this one included
 * (RC-12); `unlocked` is in the current session (RC-20), and `missing`
 * says that an encryption key reset deleted the secret (NF-8.6), so that a
 * client offers to replace the credentials rather than to unlock them. Each
 * is an item of `SavedCredentials` with `kind` and `usedBy`. Named `…Info`,
 * since `RepositoryCredentials` is the request's union.
 */
export const RepositoryCredentialsInfoSchema = z
  .object({
    protocol: z.enum([ 'https', 'ssh' ]),
    inUse: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('https'), ...SavedHttpsCredentialsSchema.shape, usedBy: z.number().int() }),
        z.object({ kind: z.literal('ssh-key'), ...SavedSshKeySchema.shape, usedBy: z.number().int() })
      ])
      .nullable()
  })
  .meta({ id: 'RepositoryCredentialsInfo' });

/**
 * A new username and password or token for the saved HTTPS credentials a
 * repository uses (RC-12, RC-13). Neither is trimmed, as when they were saved
 * (AR-20). The name is kept.
 */
export const UpdateTokenRequestSchema = z
  .object({
    username: NewHttpsCredentialsSchema.shape.username,
    password: NewHttpsCredentialsSchema.shape.password
  })
  .meta({ id: 'UpdateTokenRequest' });

export type RepositoryCredentialsInfo = z.infer<typeof RepositoryCredentialsInfoSchema>;
export type UpdateTokenRequest = z.infer<typeof UpdateTokenRequestSchema>;
