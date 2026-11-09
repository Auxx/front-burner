import type { GitStatus } from '@front-burner/shared-contracts';

/**
 * Why **Fetch** is not offered, as a message key, or `null` when it is (GA-9).
 * Only an unread status stops it: the backend fetches the remote of any
 * repository, also during a merge (GC-3). Another network job running is not
 * a reason here; the actions tell it from `running`.
 */
export function fetchUnavailableReason(status: GitStatus | null): string | null {
  return status === null ? 'loading' : null;
}

/**
 * Why **Pull** is not offered, as a message key, or `null` when it is (GA-8): for
 * an upstream that is not gone, also with nothing to pull, since it fetches first,
 * and for a branch with no upstream whose remote branch of its name it would adopt.
 * Uncommitted changes are not a reason: the backend says so, for every client (GA-26).
 */
export function pullUnavailableReason(status: GitStatus | null): string | null {
  if (status === null) {
    return 'loading';
  }
  if (status.mergeInProgress) {
    return 'merging';
  }
  if (status.branch === null) {
    return 'noBranch';
  }
  if (status.noCommits) {
    return 'noCommits';
  }
  if (status.upstream !== null) {
    return status.upstreamGone ? 'upstreamGone' : null;
  }
  return status.sameNameRemote ? null : 'noUpstream';
}

/** Why **Push** is not offered, as a message key, or `null` when it is (GA-8). */
export function pushUnavailableReason(status: GitStatus | null): string | null {
  if (status === null) {
    return 'loading';
  }
  if (status.mergeInProgress) {
    return 'merging';
  }
  if (status.branch === null) {
    return 'noBranch';
  }
  if (status.noCommits) {
    return 'noCommits';
  }
  // An unpublished branch, or one whose upstream is gone, is pushed to create it (GA-29).
  if (status.upstream === null || status.upstreamGone) {
    return null;
  }
  return status.ahead > 0 ? null : 'nothingToPush';
}
