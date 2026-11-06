import { z } from 'zod';
import { SSH_KEY_TYPES } from '../credentials/credentials.schema';

/**
 * The credentials a repository uses, for the repository credentials dialog
 * and the locked-key banner (RC-7, RC-12, RC-15, RC-16). Public parts only
 * (A-3.5). `protocol` is the remote's, which the dialog cannot change (RC-7);
 * `inUse` is null for a repository without credentials. `usedBy` counts the
 * user's repositories that use the same credentials, this one included
 * (RC-12); `unlocked` is in the current session (RC-20). The field names
 * follow the items of `SavedCredentials`. Named `…Info`, since
 * `RepositoryCredentials` is the request's union.
 */
export const RepositoryCredentialsInfoSchema = z
  .object({
    protocol: z.enum([ 'https', 'ssh' ]),
    inUse: z
      .discriminatedUnion('kind', [
        z.object({
          kind: z.literal('https'),
          id: z.number().int(),
          name: z.string(),
          username: z.string(),
          usedBy: z.number().int()
        }),
        z.object({
          kind: z.literal('ssh-key'),
          id: z.number().int(),
          name: z.string(),
          keyType: z.enum(SSH_KEY_TYPES),
          fingerprint: z.string(),
          passphraseProtected: z.boolean(),
          unlocked: z.boolean(),
          usedBy: z.number().int()
        })
      ])
      .nullable()
  })
  .meta({ id: 'RepositoryCredentialsInfo' });

export type RepositoryCredentialsInfo = z.infer<typeof RepositoryCredentialsInfoSchema>;
