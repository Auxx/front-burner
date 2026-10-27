import { parseRemoteUrl } from '@front-burner/shared-util';
import { z } from 'zod';
import { CREDENTIALS_FIELD_CODES, NewHttpsCredentialsSchema, NewSshKeySchema } from '../credentials/credentials.schema';
import { CLONE_MODES, GIT_LEVELS } from './repository-summary.schema';

/** A remote URL of AR-8 to AR-10; the issue's code is the parser's problem. */
export const RemoteUrlSchema = z.string().trim().superRefine((url, ctx) => {
  const result = parseRemoteUrl(url);
  if (!result.ok) {
    ctx.addIssue({ code: 'custom', message: 'Use an HTTPS or SSH URL', params: { code: result.problem } });
  }
});

/** AR-14; unique among the user's repositories, ignoring case, is checked by the backend (AR-15). */
export const RepositoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(name => !/\p{Cc}/u.test(name), { params: { code: 'control-character' } });

/**
 * The credentials of an access check or a new repository (AR-16 to AR-32). A
 * generated key is already saved (AR-29), so it is sent as `saved`; a
 * passphrase unlocks a saved key for the session (AR-25, AR-31).
 */
export const RepositoryCredentialsSchema = z
  .discriminatedUnion('mode', [
    z.object({ mode: z.literal('none') }),
    z.object({
      mode: z.literal('saved'),
      credentialId: z.int().positive(),
      passphrase: z.string().min(1).max(1024).optional()
    }),
    z.object({ mode: z.literal('new-https'), ...NewHttpsCredentialsSchema.shape }),
    z.object({ mode: z.literal('new-ssh-key'), ...NewSshKeySchema.shape })
  ])
  .meta({ id: 'RepositoryCredentials' });

/** The protocols each mode works with; a saved credential's kind is checked by the backend. */
const MODE_PROTOCOLS: Record<RepositoryCredentials['mode'], readonly ('https' | 'ssh')[]> = {
  none: [ 'https' ],
  saved: [ 'https', 'ssh' ],
  'new-https': [ 'https' ],
  'new-ssh-key': [ 'ssh' ]
};

/** No credentials or new ones only with a matching protocol (AR-16, AR-22). */
function checkProtocol(
  value: { remoteUrl: string; credentials: RepositoryCredentials; },
  ctx: z.core.$RefinementCtx
): void {
  const result = parseRemoteUrl(value.remoteUrl);
  if (result.ok && !MODE_PROTOCOLS[value.credentials.mode].includes(result.remote.protocol)) {
    ctx.addIssue({ code: 'custom', path: [ 'credentials' ], params: { code: 'protocol-mismatch' } });
  }
}

/** Runs an access check for the form's branch list (AR-35). */
export const AccessCheckRequestSchema = z
  .object({ remoteUrl: RemoteUrlSchema, credentials: RepositoryCredentialsSchema })
  .superRefine(checkProtocol)
  .meta({ id: 'AccessCheckRequest' });

/** The remote's branches, sorted by name, and its default branch (null for an empty remote, AR-37). */
export const AccessCheckResultSchema = z
  .object({ branches: z.array(z.string()), defaultBranch: z.string().nullable() })
  .meta({ id: 'AccessCheckResult' });

/**
 * The Add repository form (AR-5, AR-41). `branch` is required for a
 * single-branch clone and ignored for a full one; `gitLevel` defaults to the
 * highest level the user is allowed (AR-39).
 */
export const AddRepositoryRequestSchema = z
  .object({
    remoteUrl: RemoteUrlSchema,
    name: RepositoryNameSchema,
    credentials: RepositoryCredentialsSchema,
    cloneMode: z.enum(CLONE_MODES),
    branch: z.string().min(1).max(255).optional(),
    gitLevel: z.enum(GIT_LEVELS).optional()
  })
  .superRefine((value, ctx) => {
    checkProtocol(value, ctx);
    if (value.cloneMode === 'single-branch' && value.branch === undefined) {
      ctx.addIssue({ code: 'custom', path: [ 'branch' ], params: { code: 'required' } });
    }
  })
  .meta({ id: 'AddRepositoryRequest' });

/** Every repository of the user (at most 50, NF-1.3), for the form's early checks (AR-12, AR-15). */
export const RepositoryIndexSchema = z
  .object({ repositories: z.array(z.object({ name: z.string(), remoteKey: z.string() })) })
  .meta({ id: 'RepositoryIndex' });

/**
 * Field codes the backend finds on an access check or a submit (AR-42), on
 * `remoteUrl`, `name`, `credentials`, `credentials.privateKey`,
 * `credentials.passphrase`, `branch` and `gitLevel`. The key problems of saved
 * credentials (AR-27) come on the `credentials.` fields too.
 */
export const ADD_REPOSITORY_FIELD_CODES = [
  'host-unreachable',
  'tls-untrusted',
  'repository-not-found',
  'host-key-changed',
  'name-taken',
  'credentials-refused',
  'credentials-required',
  'kind-mismatch',
  'protocol-mismatch',
  'control-character',
  'branch-not-found',
  'no-branches',
  'level-not-allowed',
  ...CREDENTIALS_FIELD_CODES.filter(code => code !== 'name-taken')
] as const;

export type RepositoryCredentials = z.infer<typeof RepositoryCredentialsSchema>;
export type AccessCheckRequest = z.infer<typeof AccessCheckRequestSchema>;
export type AccessCheckResult = z.infer<typeof AccessCheckResultSchema>;
export type AddRepositoryRequest = z.infer<typeof AddRepositoryRequestSchema>;
export type RepositoryIndex = z.infer<typeof RepositoryIndexSchema>;
export type AddRepositoryFieldCode = (typeof ADD_REPOSITORY_FIELD_CODES)[number];
