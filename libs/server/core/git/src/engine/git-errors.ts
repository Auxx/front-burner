import { isFolder } from '@front-burner/server-core-storage';
import type { EgressRefusal } from '../egress/egress-proxy';
import type { GitResult } from '../runner/git-runner';
import { redactCredentials } from '../runner/redact';

/** Why a git operation failed. */
export const GIT_ERROR_CODES = [
  'host-unreachable',
  'timeout',
  /** git was killed because its job was cancelled; nothing about the remote. */
  'cancelled',
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
  /** A new branch needs a commit to start from. */
  'no-commits',
  /** Another git holds a lock that this command needs, such as a push writing the upstream; nothing changed. */
  'git-busy',
  /**
   * The working copy folder is gone, or git can't read a repository in it
   * (RM-6). Any command run in a working copy can give it; `GitRunner` checks
   * for it only when the command failed.
   */
  'working-copy-missing',
  /**
   * The disk is full: git said so, or a file it needed could not be written
   * (NF-9.8). `GitRunner` checks for it after any failure, like
   * `working-copy-missing`.
   */
  'storage-full',
  'failed'
] as const;

export type GitErrorCode = (typeof GIT_ERROR_CODES)[number];

export class GitOperationError extends Error {
  /**
   * @param detail git's stderr, with credentials removed; for the log and a
   *   failed clone's error record (RM-10), never for an API error response.
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
    /SSL certificate (problem|OpenSSL verify result|verification failed)|server (certificate )?verification failed|SSL: no alternative certificate subject name/,
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
  if (result.aborted) {
    return 'cancelled';
  }
  if (result.timedOut) {
    return 'timeout';
  }
  if (refusals.length > 0) {
    return 'host-unreachable';
  }
  return PATTERNS.find(([ pattern ]) => pattern.test(result.stderr))?.[1] ?? 'failed';
}

/**
 * What git says when it finds no repository in its folder, or one it can't
 * read, such as a `.git` without `HEAD`. It says the same of any repository it
 * reads, such as a submodule whose folder in `.git/modules` is gone, so it is
 * only a hint, which `assertWorkingCopyFound` checks against the working copy.
 * Git's words depend on its version and on what it found: a `.git` file that
 * points nowhere is "not a git repository: <path>" up to git 2.47 and "gitfile
 * does not point to a valid repository" after, one that is not a gitfile is
 * "invalid gitfile format", and `git config --local` outside a repository says
 * it in its own words.
 */
const NOT_A_REPOSITORY =
  /^fatal: (not a git repository|gitfile does not point to a valid repository|invalid gitfile format|--local can only be used inside a git repository)/m;

/** The detail of a working copy folder that is gone; git never started, so it said nothing. */
export const WORKING_COPY_FOLDER_GONE = 'The working copy folder does not exist.';

/**
 * Throws `working-copy-missing` when a git that failed in `cwd` did so because
 * the folder is gone or holds no repository git can read (RM-6), with git's
 * message about the working copy as the detail. When git said it found no
 * repository, `readsRepository` asks again of the working copy alone (`git
 * rev-parse --git-dir` in `cwd`), so that a broken submodule is not taken for
 * a damaged working copy. Only that: any other failure, such as a lock file or
 * a timeout, is not damage, and calling a working copy damaged sends the user
 * to **Clone again**, which loses work (RM-12).
 */
export async function assertWorkingCopyFound(
  cwd: string,
  result: GitResult,
  readsRepository: () => Promise<GitResult>
): Promise<void> {
  if (NOT_A_REPOSITORY.test(result.stderr)) {
    const check = await readsRepository();
    if (check.exitCode !== 0 && !check.timedOut && NOT_A_REPOSITORY.test(check.stderr)) {
      throw new GitOperationError('working-copy-missing', check.stderr);
    }
    return;
  }
  // Node can't start a process in a folder that is gone: no exit code, and no timeout either.
  if (result.exitCode === null && !result.timedOut && !(await isFolder(cwd))) {
    throw new GitOperationError('working-copy-missing', WORKING_COPY_FOLDER_GONE);
  }
}

/**
 * The C library's text for `ENOSPC` and `EDQUOT`, which git and the programs
 * it runs print as they are (NF-9.8). Only in git's own lines: a `remote: `
 * line is about the remote's disk, not ours.
 */
const NO_SPACE = /^(?!remote:).*(No space left on device|Disk quota exceeded)/m;

/** Whether a failed git said that the disk is full (NF-9.8). */
export const isOutOfSpace = (stderr: string): boolean => NO_SPACE.test(stderr);

/** What git says when another git holds a lock that it needs; nothing changed. */
const LOCK_HELD =
  /^(error: could not lock config file .*: File exists|fatal: .*Unable to create '.*\.lock': File exists)/m;

/** Whether a local git command failed only because another git holds a lock (`git-busy`). */
export const isLockHeld = (stderr: string): boolean => LOCK_HELD.test(stderr);

// Anchored, as these lines can come with a file's or a branch's name. The first match wins.
const BRANCH_PATTERNS: [ RegExp, GitErrorCode ][] = [
  [ /^fatal: a branch named .* already exists/m, 'branch-exists' ],
  // Not every "cannot lock ref": a lock another git holds says that too.
  [ /^fatal: cannot lock ref '.*': '.*' exists; cannot create /m, 'branch-name-conflict' ],
  [ LOCK_HELD, 'git-busy' ],
  [ /^fatal: invalid reference: /m, 'branch-not-found' ],
  [ /^fatal: the requested upstream branch .* does not exist/m, 'branch-not-found' ],
  // What git won't switch to by this name, such as a branch called `@`.
  [ /^fatal: a branch is expected/m, 'branch-not-found' ],
  // A ref that the working copy's fetch refspec doesn't cover, so it isn't a branch of the remote any more.
  [ /^fatal: cannot set up tracking information/m, 'branch-not-found' ],
  // Git checks the whole tree first, and says this after anything it won't overwrite or lose.
  [ /^error: .*would be overwritten|^Aborting$/m, 'switch-blocked' ]
];

/** The code of a failed `git switch` or `git branch` (RC-5), or `null` for a failure with no meaning to a user. */
export function classifyBranchFailure(stderr: string): GitErrorCode | null {
  return BRANCH_PATTERNS.find(([ pattern ]) => pattern.test(stderr))?.[1] ?? null;
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
  if (result.aborted || result.timedOut || refusals.length > 0) {
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
