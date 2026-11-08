import type { GitStatus } from '@front-burner/shared-contracts';

import { fetchUnavailableReason, pushUnavailableReason } from './git-action-reasons';

function status(changes: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: 'main',
    noCommits: false,
    lastCommit: null,
    upstream: 'origin/main',
    upstreamGone: false,
    ahead: 2,
    behind: 0,
    changes: [],
    mergeInProgress: false,
    networkJob: null,
    fetchProblem: null,
    ...changes
  };
}

describe('fetchUnavailableReason', () => {
  it.each<[ string, Partial<GitStatus>, string | null ]>([
    [ 'a branch', {}, null ],
    [ 'no branch', { branch: null }, null ],
    [ 'no commits', { noCommits: true, upstream: null, ahead: 0 }, null ],
    [ 'a merge in progress', { mergeInProgress: true }, null ]
  ])('offers Fetch with %s', (_name, changes, reason) => {
    expect(fetchUnavailableReason(status(changes))).toBe(reason);
  });

  it('is not offered until a status has been read', () => {
    expect(fetchUnavailableReason(null)).toBe('loading');
  });
});

describe('pushUnavailableReason', () => {
  it.each<[ string, Partial<GitStatus>, string | null ]>([
    [ 'commits to push', {}, null ],
    [ 'an unpublished branch', { upstream: null, ahead: 0 }, null ],
    [ 'an upstream that is gone', { upstreamGone: true, ahead: 0 }, null ],
    [ 'nothing to push', { ahead: 0 }, 'nothingToPush' ],
    [ 'no commits', { noCommits: true, upstream: null, ahead: 0 }, 'noCommits' ],
    [ 'no branch', { branch: null }, 'noBranch' ],
    [ 'a merge in progress', { mergeInProgress: true }, 'merging' ]
  ])('with %s', (_name, changes, reason) => {
    expect(pushUnavailableReason(status(changes))).toBe(reason);
  });

  it('until a status has been read', () => {
    expect(pushUnavailableReason(null)).toBe('loading');
  });
});
