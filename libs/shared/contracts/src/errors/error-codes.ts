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
  'cross-site-refused'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
