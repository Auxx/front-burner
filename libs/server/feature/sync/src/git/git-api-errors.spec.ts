import { GitOperationError } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { toGitApiError } from './git-api-errors';

describe('toGitApiError', () => {
  const answerTo = (error: unknown) => {
    try {
      toGitApiError(error);
    } catch (thrown) {
      return thrown;
    }
    throw new Error('nothing was thrown');
  };

  it.each(
    [
      [ 'nothing-to-commit', 409, 'nothing-to-commit' ],
      [ 'detached-head', 409, 'detached-head' ],
      [ 'discard-blocked', 409, 'discard-blocked' ],
      [ 'timeout', 504, 'git-timeout' ]
    ] as const
  )('answers %s with %i %s', (code, status, apiCode) => {
    const answer = answerTo(new GitOperationError(code, ''));

    expect(answer).toBeInstanceOf(ApiErrorException);
    expect((answer as ApiErrorException).getStatus()).toBe(status);
    expect((answer as ApiErrorException).code).toBe(apiCode);
  });

  it('rethrows anything else', () => {
    const failure = new GitOperationError('failed', '');
    expect(answerTo(failure)).toBe(failure);
    const other = new Error('disk full');
    expect(answerTo(other)).toBe(other);
  });
});
