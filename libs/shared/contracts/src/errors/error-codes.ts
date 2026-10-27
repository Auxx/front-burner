/** Stable error codes the backend may return in an `ApiError` (A-3.3). */
export const ERROR_CODES = [
  'not-found',
  'validation-failed',
  'malformed-request',
  'payload-too-large',
  'rate-limited',
  'internal',
  'unauthenticated',
  'auth-token-expired',
  'wrong-credentials',
  'refresh-refused',
  'cross-site-refused',
  'oidc-code-invalid',
  'too-many-jobs',
  'key-locked',
  'credentials-missing',
  'host-key-changed',
  /** The remote did not answer in time; params `{ host }` (AR-42). */
  'remote-timeout',
  /** Any other failure of the remote (AR-42). */
  'remote-failed',
  /** 409; params are a `HostKey` for the user to trust (AR-32). */
  'host-key-unknown'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
