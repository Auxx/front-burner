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
  /** 429; five wrong passphrases for this key within a minute (RC-18). */
  'unlock-too-many-attempts',
  'credentials-missing',
  /** 409; the repository uses no saved HTTPS credentials to update in place: none, an SSH key, or replaced meanwhile (RC-14). */
  'credentials-not-updatable',
  'host-key-changed',
  /** The remote did not answer in time; params `{ host }` (AR-42). */
  'remote-timeout',
  /** Any other failure of the remote (AR-42). */
  'remote-failed',
  /** 409; params are a `HostKey` for the user to trust (AR-32). */
  'host-key-unknown',
  /** 409; no key is trusted for this host and port yet, so there is none to replace (RC-22); params `{ host, port }`. */
  'host-key-not-trusted',
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
  'entry-exists',
  /** 415; a repository image whose format the preview doesn't show (IM-9). */
  'image-format-unsupported',
  /** 413; a repository image over the 10 MB limit; params `{ limit }` in bytes (IM-9). */
  'image-too-large',
  /** 409; the user has not confirmed their commit author yet (CA-13). */
  'commit-author-not-confirmed',
  /** 409; none of a commit's paths is a change. */
  'nothing-to-commit',
  'discard-blocked',
  /** 409; HEAD is on no branch, so a commit would belong to none. */
  'detached-head',
  /** 409; the last commit was pushed, is a merge commit, or does not exist (GA-22). */
  'amend-not-allowed',
  /** 504; a local git command ran past `FRONT_BURNER_GIT_TIMEOUT` (NF-11.8). */
  'git-timeout',
  /** 409; HEAD is on no branch, so there is nothing to push. */
  'no-branch',
  /** 409; the branch has no commits yet (GA-42). */
  'no-commits',
  /** 409; the upstream has every commit of the branch (GA-8). */
  'nothing-to-push',
  /**
   * 409; no upstream to pull from: no commits, an upstream that is gone, or an
   * unpublished branch without a remote branch of its name (GA-8).
   */
  'no-upstream',
  /** 409; the working copy has uncommitted changes, so a pull does not start (GA-26). */
  'uncommitted-changes',
  // How a pull job ended, besides the codes above and `merge-in-progress` and `commit-author-not-confirmed`.
  /** The current branch is not the one the pull was asked for; params `{ branch }`, the one asked for. */
  'branch-changed',
  /**
   * The merge would overwrite files that git does not track, such as ignored
   * ones; params `{ paths }`, one per line.
   */
  'merge-blocked',
  // How a push job ended; params as named, and `branch` (GA-30, GA-31, RC-4, RC-5, CA-15).
  /** The remote needs credentials and the repository has none (RC-4). */
  'no-credentials',
  /** The remote refused the credentials: wrong, expired or revoked (RC-4). */
  'credentials-refused',
  /** The credentials may read but not push (RC-4, RC-5). */
  'push-not-allowed',
  /** The upstream has commits that the branch does not (GA-30). */
  'push-non-fast-forward',
  /** params `{ remoteMessages }`, the remote's own lines, as for the other refusals (GA-31). */
  'push-protected-branch',
  /** The remote takes only signed commits (CA-15). */
  'push-unsigned',
  /** Refused for another reason, such as a server hook (GA-31). */
  'push-rejected',
  /** params `{ host }`. */
  'host-unreachable',
  'tls-untrusted',
  'repository-not-found',
  /** The backend stopped while the job ran (NF-9.5). */
  'interrupted'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
