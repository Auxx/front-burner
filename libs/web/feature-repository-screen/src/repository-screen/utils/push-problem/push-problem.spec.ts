import { pushProblem } from './push-problem';

describe('pushProblem', () => {
  it.each([
    [ 'no-credentials', 'errors.no-credentials', 'add-credentials' ],
    [ 'credentials-refused', 'errors.credentials-refused', 'fix-credentials' ],
    [ 'push-not-allowed', 'errors.push-not-allowed', 'other-credentials' ],
    [ 'key-locked', 'web-feature-repository-screen.pushProblem.key-locked', 'unlock' ],
    [ 'host-key-changed', 'errors.host-key-changed', 'review-host-key' ]
  ])('maps every code of RC-4 to its message and fix: %s', (code, messageKey, fix) => {
    expect(pushProblem(code)).toEqual({ messageKey, fix });
  });

  it.each([ 'push-non-fast-forward', 'push-protected-branch', 'push-unsigned', 'push-rejected' ])(
    'offers no fix for a refusal of the remote: %s',
    code => {
      expect(pushProblem(code)).toEqual({ messageKey: `errors.${code}`, fix: null });
    }
  );

  it.each([ 'remote-timeout', 'remote-failed', 'host-unreachable', 'interrupted', 'network', 'internal' ])(
    'offers Try again when the network or the server failed: %s',
    code => {
      expect(pushProblem(code)).toEqual({ messageKey: `errors.${code}`, fix: 'retry' });
    }
  );

  it('offers to trust an unknown host, and to add credentials that are gone', () => {
    expect(pushProblem('host-key-unknown').fix).toBe('trust-host');
    expect(pushProblem('credentials-missing').fix).toBe('add-credentials');
  });

  it('says that the remote failed for a code it does not know', () => {
    expect(pushProblem('something-new')).toEqual({ messageKey: 'errors.remote-failed', fix: 'retry' });
  });
});
