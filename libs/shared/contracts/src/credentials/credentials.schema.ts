import { z } from 'zod';

/** Unique among the user's credentials of one kind, ignoring case (AR-18). */
export const credentialName = z.string().trim().min(1).max(100);

/** New HTTPS credentials (AR-20). The username and password are never trimmed. */
export const NewHttpsCredentialsSchema = z
  .object({
    name: credentialName,
    username: z.string().min(1).max(256),
    password: z.string().min(1).max(4096)
  })
  .meta({ id: 'NewHttpsCredentials' });

/** A pasted SSH key (AR-26). The passphrase is never trimmed. */
export const NewSshKeySchema = z
  .object({
    name: credentialName,
    privateKey: z.string().min(1).max(16_384),
    passphrase: z.string().max(1024).optional()
  })
  .meta({ id: 'NewSshKey' });

/** The SSH key types the backend accepts (AR-27). */
export const SSH_KEY_TYPES = [ 'ed25519', 'ecdsa', 'rsa' ] as const;

/**
 * Saved HTTPS credentials without their password (AR-17, AR-19). `missing`:
 * the password was deleted by an encryption key reset (NF-8.6).
 */
export const SavedHttpsCredentialsSchema = z
  .object({ id: z.number().int(), name: z.string(), username: z.string(), missing: z.boolean() })
  .meta({ id: 'SavedHttpsCredentials' });

/** A saved SSH key without its private key (AR-24, AR-25); `unlocked` in the current session (AR-31). */
export const SavedSshKeySchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    keyType: z.enum(SSH_KEY_TYPES),
    fingerprint: z.string(),
    passphraseProtected: z.boolean(),
    unlocked: z.boolean(),
    generated: z.boolean(),
    missing: z.boolean()
  })
  .meta({ id: 'SavedSshKey' });

/** The user's saved credentials, each list sorted by name. */
export const SavedCredentialsSchema = z
  .object({ https: z.array(SavedHttpsCredentialsSchema), sshKeys: z.array(SavedSshKeySchema) })
  .meta({ id: 'SavedCredentials' });

export const GenerateSshKeyRequestSchema = z.object({ name: credentialName }).meta({ id: 'GenerateSshKeyRequest' });

/** A key generated and saved at once (AR-29), with its public key in `authorized_keys` format. */
export const GeneratedSshKeySchema = z
  .object({ key: SavedSshKeySchema, publicKey: z.string() })
  .meta({ id: 'GeneratedSshKey' });

export const UnlockSshKeyRequestSchema = z
  .object({ passphrase: z.string().min(1).max(1024) })
  .meta({ id: 'UnlockSshKeyRequest' });

const hostKeyFields = {
  host: z.string().min(1).max(253),
  port: z.int().min(1).max(65_535),
  /** As `ssh` names it, for example `ssh-ed25519`. */
  type: z.string().min(1).max(64),
  /** The public key blob in base64. */
  key: z.string().min(1).max(4096)
};

/** A server's host key, as an unknown-host-key error describes it (AR-32). */
export const HostKeySchema = z
  .object({ ...hostKeyFields, fingerprint: z.string() })
  .meta({ id: 'HostKey' });

/** Trusts a host key; the backend works out the fingerprint itself. */
export const TrustHostRequestSchema = z.object(hostKeyFields).meta({ id: 'TrustHostRequest' });

/**
 * Field codes of saved credentials: `name-taken` on `name` (AR-18), the others
 * on `privateKey` or `passphrase` (AR-27).
 */
export const CREDENTIALS_FIELD_CODES = [
  'name-taken',
  'invalid-key',
  'unsupported-type',
  'rsa-too-short',
  'passphrase-required',
  'wrong-passphrase',
  'passphrase-not-needed'
] as const;

export type CredentialsFieldCode = (typeof CREDENTIALS_FIELD_CODES)[number];
export type SshKeyType = (typeof SSH_KEY_TYPES)[number];
export type NewHttpsCredentials = z.infer<typeof NewHttpsCredentialsSchema>;
export type NewSshKey = z.infer<typeof NewSshKeySchema>;
export type SavedHttpsCredentials = z.infer<typeof SavedHttpsCredentialsSchema>;
export type SavedSshKey = z.infer<typeof SavedSshKeySchema>;
export type SavedCredentials = z.infer<typeof SavedCredentialsSchema>;
export type GenerateSshKeyRequest = z.infer<typeof GenerateSshKeyRequestSchema>;
export type GeneratedSshKey = z.infer<typeof GeneratedSshKeySchema>;
export type UnlockSshKeyRequest = z.infer<typeof UnlockSshKeyRequestSchema>;
export type HostKey = z.infer<typeof HostKeySchema>;
export type TrustHostRequest = z.infer<typeof TrustHostRequestSchema>;
