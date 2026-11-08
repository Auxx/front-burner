import { GitOperationError } from '@front-burner/server-core-git';
import { networkFailure } from './network-failure';

const codeOf = (error: GitOperationError, hasCredentials = true) => networkFailure(error, hasCredentials).code;

describe('networkFailure', () => {
  it('tells refused credentials from none at all', () => {
    expect(codeOf(new GitOperationError('auth-failed', ''), true)).toBe('credentials-refused');
    expect(codeOf(new GitOperationError('auth-failed', ''), false)).toBe('no-credentials');
  });

  it('names a timeout remote-timeout', () => {
    expect(codeOf(new GitOperationError('timeout', ''))).toBe('remote-timeout');
  });

  it.each(
    [
      'push-non-fast-forward',
      'push-not-allowed',
      'push-protected-branch',
      'push-unsigned',
      'push-rejected',
      'host-unreachable',
      'tls-untrusted',
      'repository-not-found',
      'host-key-changed',
      'host-key-unknown'
    ] as const
  )('keeps the code %s', code => {
    expect(codeOf(new GitOperationError(code, ''))).toBe(code);
  });

  it.each([ 'failed', 'branch-not-found', 'unsafe-repository-config' ] as const)(
    'names %s remote-failed',
    code => {
      expect(codeOf(new GitOperationError(code, ''))).toBe('remote-failed');
    }
  );

  it('puts git\'s params after the job\'s', () => {
    const error = new GitOperationError('push-rejected', '', { remoteMessages: 'Frozen', branch: 'other' });

    expect(networkFailure(error, true, { branch: 'main', extra: 'x' })).toEqual({
      kind: 'failed',
      code: 'push-rejected',
      params: { branch: 'other', extra: 'x', remoteMessages: 'Frozen' }
    });
  });

  it('has no params of its own without any', () => {
    expect(networkFailure(new GitOperationError('timeout', ''), true).params).toEqual({});
  });
});
