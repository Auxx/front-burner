import { gitProblem } from './git-problem';

describe('gitProblem', () => {
  it.each([
    [ 'no-credentials', 'errors.no-credentials', 'add-credentials' ],
    [ 'credentials-refused', 'errors.credentials-refused', 'fix-credentials' ],
    [ 'push-not-allowed', 'errors.push-not-allowed', 'other-credentials' ],
    [ 'key-locked', 'web-feature-repository-screen.gitProblem.key-locked', 'unlock' ],
    [ 'host-key-changed', 'errors.host-key-changed', 'review-host-key' ]
  ])('maps every code of RC-4 to its message and fix: %s', (code, messageKey, fix) => {
    expect(gitProblem(code)).toEqual({ messageKey, fix });
  });

  it('offers Show changes for uncommitted changes', () => {
    expect(gitProblem('uncommitted-changes').fix).toBe('show-changes');
  });

  it('offers Try again for an author not confirmed, which asks', () => {
    expect(gitProblem('commit-author-not-confirmed').fix).toBe('retry');
  });

  it('offers Pull for a push the remote refused', () => {
    expect(gitProblem('push-non-fast-forward').fix).toBe('pull');
  });

  it.each([
    [ 'changed-on-disk', 'web-feature-repository-screen.gitProblem.changed-on-disk', null ],
    [ 'file-gone', 'web-feature-repository-screen.gitProblem.file-gone', null ],
    [ 'file-held', 'errors.file-held', 'retry' ]
  ])('says what a save that stopped a pull needs, without Changes\' ticks: %s', (code, messageKey, fix) => {
    expect(gitProblem(code)).toEqual({ messageKey, fix });
  });

  it.each([ 'push-protected-branch', 'push-unsigned', 'push-rejected' ])(
    'offers no fix for a refusal of the remote: %s',
    code => {
      expect(gitProblem(code)).toEqual({ messageKey: `errors.${code}`, fix: null });
    }
  );

  it.each([ 'remote-timeout', 'remote-failed', 'host-unreachable', 'interrupted', 'network', 'internal', 'git-busy' ])(
    'offers Try again when the network or the server failed: %s',
    code => {
      expect(gitProblem(code)).toEqual({ messageKey: `errors.${code}`, fix: 'retry' });
    }
  );

  it('offers to trust an unknown host, and to add credentials that are gone', () => {
    expect(gitProblem('host-key-unknown').fix).toBe('trust-host');
    expect(gitProblem('credentials-missing').fix).toBe('add-credentials');
  });

  it('says that the remote failed for a code it does not know', () => {
    expect(gitProblem('something-new')).toEqual({ messageKey: 'errors.remote-failed', fix: 'retry' });
  });
});
