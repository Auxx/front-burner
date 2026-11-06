import { ERROR_CODES } from '@front-burner/shared-contracts';

/** The fix a push problem offers, if any; plans 60, 63, 64 and 66 connect them to their dialogs. */
export type PushFix =
  | 'add-credentials'
  | 'fix-credentials'
  | 'other-credentials'
  | 'unlock'
  | 'review-host-key'
  | 'trust-host'
  | 'retry'
  | null;

/** What a push problem says, and the fix it offers. */
export interface PushProblemText {
  /** A Transloco key, used with the problem's params. */
  readonly messageKey: string;
  readonly fix: PushFix;
}

/** Messages of push problems that `errors.<code>` does not word as RC-4 does. */
const MESSAGE_KEYS: Readonly<Record<string, string>> = {
  'key-locked': 'web-feature-repository-screen.pushProblem.key-locked'
};

/** RC-4's offers, and **Try again** where the cause is the network or the server (GA-43). */
const FIXES: Readonly<Record<string, PushFix>> = {
  'no-credentials': 'add-credentials',
  'credentials-missing': 'add-credentials',
  'credentials-refused': 'fix-credentials',
  'push-not-allowed': 'other-credentials',
  'key-locked': 'unlock',
  'host-key-changed': 'review-host-key',
  'host-key-unknown': 'trust-host',
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

const KNOWN_CODES: ReadonlySet<string> = new Set<string>([ ...ERROR_CODES, 'network' ]);

/**
 * The one table from a push's error code to its message and fix (RC-4, GA-30,
 * GA-31, GA-43). The push is never forced, so "The remote has new commits. Pull
 * first." offers no fix until step 4 brings **Pull**. A code the web client does
 * not know says that something went wrong with the remote.
 */
export function pushProblem(code: string): PushProblemText {
  const messageKey = MESSAGE_KEYS[code] ?? (KNOWN_CODES.has(code) ? `errors.${code}` : 'errors.remote-failed');
  return { messageKey, fix: FIXES[code] ?? (KNOWN_CODES.has(code) ? null : 'retry') };
}
