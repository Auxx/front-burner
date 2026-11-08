import { ERROR_CODES } from '@front-burner/shared-contracts';

/** The fix a git problem offers, if any; `CredentialFixesService` connects each to what it does. */
export type GitFix =
  | 'add-credentials'
  | 'fix-credentials'
  | 'other-credentials'
  | 'unlock'
  | 'review-host-key'
  | 'trust-host'
  | 'retry'
  | 'show-changes'
  | 'pull'
  | null;

/** What a git problem says, and the fix it offers. */
export interface GitProblemText {
  /** A Transloco key, used with the problem's params. */
  readonly messageKey: string;
  readonly fix: GitFix;
}

/** Messages of git problems that `errors.<code>` does not word as RC-4 does. */
const MESSAGE_KEYS: Readonly<Record<string, string>> = {
  'key-locked': 'web-feature-repository-screen.gitProblem.key-locked',
  // As a pull has them: `errors.<code>` speaks of a commit's ticks.
  'changed-on-disk': 'web-feature-repository-screen.gitProblem.changed-on-disk',
  'file-gone': 'web-feature-repository-screen.gitProblem.file-gone'
};

/**
 * RC-4's offers, **Show changes** and **Pull** (GA-26, GA-30), and **Try again**
 * where the cause is the network or the server (GA-43), or a save held for a moment.
 */
const FIXES: Readonly<Record<string, GitFix>> = {
  'no-credentials': 'add-credentials',
  'credentials-missing': 'add-credentials',
  'credentials-refused': 'fix-credentials',
  'push-not-allowed': 'other-credentials',
  'key-locked': 'unlock',
  'host-key-changed': 'review-host-key',
  'host-key-unknown': 'trust-host',
  'uncommitted-changes': 'show-changes',
  'push-non-fast-forward': 'pull',
  'file-held': 'retry',
  'remote-timeout': 'retry',
  'remote-failed': 'retry',
  'host-unreachable': 'retry',
  interrupted: 'retry',
  network: 'retry',
  internal: 'retry',
  'git-timeout': 'retry',
  'rate-limited': 'retry',
  'too-many-jobs': 'retry'
};

/** The codes that have a message; the last three are the web client's own, of a save that stopped a pull. */
const KNOWN_CODES: ReadonlySet<string> = new Set<string>([
  ...ERROR_CODES,
  'network',
  'changed-on-disk',
  'file-gone',
  'file-held'
]);

/**
 * The fix the quiet fetch status offers beside **Try again**, which it always
 * has; a locked key is never a stored problem (GA-35, RC-6).
 */
export function fetchProblemFix(code: string): GitFix {
  const { fix } = gitProblem(code);
  return fix === 'retry' || fix === 'unlock' ? null : fix;
}

/**
 * The headline of the quiet fetch status, as a message key and its params;
 * `null` while it has nothing to say. A locked key comes first, as a stored
 * problem is out of date while no fetch runs here (GA-35, RC-15).
 */
export function fetchStatusHeadline(
  hasProblem: boolean,
  lockedKeyName: string | null
): { key: string; params: Record<string, string>; } | null {
  if (lockedKeyName !== null) {
    return { key: 'web-feature-repository-screen.FetchStatusComponent.locked', params: { name: lockedKeyName } };
  }
  return hasProblem ? { key: 'web-feature-repository-screen.FetchStatusComponent.failed', params: {} } : null;
}

/**
 * The one table from a network job's error code to its message and fix (RC-4,
 * GA-30, GA-31, GA-43). The push is never forced, so "The remote has new commits.
 * Pull first." offers **Pull**. A code the web client does not know says that
 * something went wrong with the remote.
 */
export function gitProblem(code: string): GitProblemText {
  const messageKey = MESSAGE_KEYS[code] ?? (KNOWN_CODES.has(code) ? `errors.${code}` : 'errors.remote-failed');
  return { messageKey, fix: FIXES[code] ?? (KNOWN_CODES.has(code) ? null : 'retry') };
}
