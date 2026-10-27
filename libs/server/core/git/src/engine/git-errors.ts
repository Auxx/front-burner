import type { EgressRefusal } from '../egress/egress-proxy';
import type { GitResult } from '../runner/git-runner';

/** Why a git operation failed. `host-key-*` come with SSH (plan 8). */
export const GIT_ERROR_CODES = [
  'host-unreachable',
  'timeout',
  'tls-untrusted',
  'auth-failed',
  'repository-not-found',
  'branch-not-found',
  'host-key-unknown',
  'host-key-changed',
  'unsafe-repository-config',
  'failed'
] as const;

export type GitErrorCode = (typeof GIT_ERROR_CODES)[number];

export class GitOperationError extends Error {
  /**
   * @param detail git's stderr, with credentials removed; for the log only.
   * @param params Values for the user's message, such as `host` (AR-42).
   */
  constructor(readonly code: GitErrorCode, readonly detail: string, readonly params: Record<string, string> = {}) {
    super(`git operation failed: ${code}`);
    this.name = 'GitOperationError';
  }
}

// git's and the servers' messages, in one place (RC-5). The first match wins.
const PATTERNS: [ RegExp, GitErrorCode ][] = [
  [
    /SSL certificate (problem|OpenSSL verify result)|server certificate verification failed|SSL: no alternative certificate subject name/,
    'tls-untrusted'
  ],
  [ /Could not resolve host|Failed to connect|Connection refused|Couldn't connect to server/, 'host-unreachable' ],
  [
    /Repository not found|repository '.*' not found|The requested URL returned error: 404|does not appear to be a git repository/i,
    'repository-not-found'
  ],
  [
    /Authentication failed|could not read Username|could not read Password|The requested URL returned error: 40[13]|Invalid username or (password|token)/,
    'auth-failed'
  ],
  [ /Remote branch .* not found/, 'branch-not-found' ]
];

/** Maps a failed git run to an error code. An egress refusal reads as an unreachable host (AR-57). */
export function classifyGitFailure(result: GitResult, refusals: EgressRefusal[]): GitErrorCode {
  if (result.timedOut) {
    return 'timeout';
  }
  if (refusals.length > 0) {
    return 'host-unreachable';
  }
  return PATTERNS.find(([ pattern ]) => pattern.test(result.stderr))?.[1] ?? 'failed';
}
