import type { EgressRefusal } from '../egress/egress-proxy';
import type { GitResult } from '../runner/git-runner';
import { redactCredentials } from '../runner/redact';

/** Why a git operation failed. */
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
  // Of push; classifyPushFailure returns these (GA-30, GA-31, RC-5, CA-15).
  /** The remote branch has commits that the local branch does not have. */
  'push-non-fast-forward',
  /** The credentials may read but not write. */
  'push-not-allowed',
  'push-protected-branch',
  /** The remote takes only signed commits. */
  'push-unsigned',
  /** Refused by the remote for another reason, such as a server hook. */
  'push-rejected',
  // Of local operations; classifyGitFailure never returns these.
  /** A commit's paths name no change. */
  'nothing-to-commit',
  /** HEAD is on no branch, so a commit would belong to none. */
  'detached-head',
  /** The last commit is on a remote branch, is a merge commit, or does not exist (GA-22). */
  'amend-not-allowed',
  /** Restoring a deleted file would replace a file or folder that is not being discarded. */
  'discard-blocked',
  /**
   * A merge would overwrite files that git does not track, or add paths that
   * are not valid UTF-8 and cannot be checked, listed in the `paths` param;
   * refused before anything changed.
   */
  'merge-blocked',
  /** Not a name git allows for a branch. */
  'branch-name-invalid',
  /** A local branch already has the name. */
  'branch-exists',
  /** `a` when `a/b` exists, or the reverse: git keeps refs as files, so it can't have both. */
  'branch-name-conflict',
  /** The switch would overwrite a file that git does not track; refused before anything changed. */
  'switch-blocked',
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
  // ssh's, first (A-5.6): a changed host key also prints "Host key verification failed".
  [ /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key for .* has changed/, 'host-key-changed' ],
  [ /No .* host key is known|Host key verification failed/, 'host-key-unknown' ],
  [ /Permission denied \(publickey/, 'auth-failed' ],
  // From proxy-connect.cjs.
  [ /egress proxy refused/, 'host-unreachable' ],
  [
    /SSL certificate (problem|OpenSSL verify result)|server (certificate )?verification failed|SSL: no alternative certificate subject name/,
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

// Anchored, as these lines can come with a file's or a branch's name. The first match wins.
const SWITCH_PATTERNS: [ RegExp, GitErrorCode ][] = [
  [ /^fatal: a branch named .* already exists/m, 'branch-exists' ],
  // Not every "cannot lock ref": a lock another git holds says that too.
  [ /^fatal: cannot lock ref '.*': '.*' exists; cannot create /m, 'branch-name-conflict' ],
  [ /^fatal: invalid reference: /m, 'branch-not-found' ],
  // A ref that the working copy's fetch refspec doesn't cover, so it isn't a branch of the remote any more.
  [ /^fatal: cannot set up tracking information/m, 'branch-not-found' ],
  // Git checks the whole tree first, and says this after anything it won't overwrite or lose.
  [ /^error: .*would be overwritten|^Aborting$/m, 'switch-blocked' ]
];

/** The code of a failed `git switch` (RC-5), or `null` for a failure with no meaning to a user. */
export function classifySwitchFailure(stderr: string): GitErrorCode | null {
  return SWITCH_PATTERNS.find(([ pattern ]) => pattern.test(stderr))?.[1] ?? null;
}

/** At most this many bytes of the remote's own lines are kept. */
const REMOTE_MESSAGES_MAX_BYTES = 64 * 1024;

// Read from git's own lines only, so that a hook cannot pass for git (RC-5). The first match wins.
const PUSH_PATTERNS: [ RegExp, GitErrorCode ][] = [
  [ /\[rejected\].*\((fetch first|non-fast-forward)\)/, 'push-non-fast-forward' ],
  [
    /The requested URL returned error: 403|marked as read only|read-only|Permission to .* denied|You do not have write access/,
    'push-not-allowed'
  ],
  [ /protected branch/, 'push-protected-branch' ],
  [ /\[remote rejected\]|pre-receive hook declined/, 'push-rejected' ]
];
// Only the remote says why it wants signed commits. Whole words: a hook's
// "Signed-off-by" or "assigned" is about something else.
const UNSIGNED = /\b(signed commits?|unsigned|must be signed|signatures?)\b/i;
// The remote's URL is in git's own lines, and its words are not git's.
const QUOTED_URL = /'[a-z][a-z0-9+.-]*:\/\/[^']*'/gi;
const URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * Maps a failed `git push --porcelain` to an error code, and collects the
 * remote's own lines (the text after `remote: `) as plain text, without
 * credentials (GA-31). Otherwise as classifyGitFailure, which reads only git's
 * own lines here.
 */
export function classifyPushFailure(
  result: GitResult,
  refusals: EgressRefusal[]
): { code: GitErrorCode; remoteMessages: string; } {
  const own: string[] = [];
  const remote: string[] = [];
  // `--porcelain` writes each ref's status to stdout, and the rest to stderr.
  for (const line of `${result.stdout}\n${result.stderr}`.split('\n')) {
    const text = line.replace(/\r$/, '');
    const fromRemote = /^remote:(?: |$)(.*)$/.exec(text);
    if (fromRemote === null) {
      own.push(text);
    } else {
      // git pads each line with spaces, to clear any progress shown before.
      remote.push((fromRemote[1] ?? '').trimEnd());
    }
  }
  const remoteMessages = limitBytes(redactCredentials(remote.join('\n')), REMOTE_MESSAGES_MAX_BYTES);
  const ownText = own.join('\n').replace(QUOTED_URL, '\'<remote>\'').replace(URL, '<remote>');
  return { code: pushCode(result, refusals, ownText, remote.join('\n')), remoteMessages };
}

function pushCode(result: GitResult, refusals: EgressRefusal[], own: string, remote: string): GitErrorCode {
  if (result.timedOut || refusals.length > 0) {
    return classifyGitFailure(result, refusals);
  }
  const code = PUSH_PATTERNS.find(([ pattern ]) => pattern.test(own))?.[1];
  // GitHub refuses unsigned commits through branch protection, so this comes before it.
  if ((code === 'push-protected-branch' || code === 'push-rejected') && UNSIGNED.test(remote)) {
    return 'push-unsigned';
  }
  return code ?? classifyGitFailure({ ...result, stderr: own }, refusals);
}

function limitBytes(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) {
    return text;
  }
  // A character cut in two decodes as U+FFFD.
  return bytes.subarray(0, maxBytes).toString('utf8').replace(/�$/, '');
}
