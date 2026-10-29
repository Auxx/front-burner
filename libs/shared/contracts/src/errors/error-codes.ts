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
  'host-key-unknown',
  /** 400; a client path the backend refuses to use; params `{ reason }` (FB-5, A-7.6). */
  'path-refused',
  /** 404; no file or folder at a path of a working copy. */
  'entry-not-found',
  /** 409; the repository is not `ready`; params `{ status }` (FB-3). */
  'repository-not-openable',
  /** 409; a merge or rebase is in progress, so the working tree can't be changed (FB-26). */
  'merge-in-progress',
  /** 413; a file to read or save is over the editor's limit; params `{ limit }` in bytes (ED-2, ED-19). */
  'file-too-large',
  /** 422; a file to read is not valid UTF-8 (ED-2, FB-21). */
  'file-not-utf8',
  /** 400; only Markdown files can be read or saved through the editor's API (ED-2, FB-21). */
  'entry-not-editable',
  /** 409; **Recreate it** found a file at the path (ED-21). */
  'entry-exists'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
