import { ApiErrorException } from '@front-burner/server-core-observability';
import { PathRefusedError } from '@front-burner/server-core-storage';
import { toFilesError } from './files-errors';

describe('toFilesError', () => {
  const answer = (error: unknown) => {
    try {
      toFilesError(error);
    } catch (thrown) {
      if (thrown instanceof ApiErrorException) {
        return { status: thrown.getStatus(), code: thrown.code, params: thrown.params };
      }
      return thrown;
    }
    throw new Error('did not throw');
  };

  it('answers a missing entry with entry-not-found', () => {
    expect(answer(new PathRefusedError('not-found'))).toEqual({ status: 404, code: 'entry-not-found', params: {} });
  });

  it.each([ 'malformed', 'inside-git', 'symlink' ] as const)('refuses a %s path with its reason', reason => {
    expect(answer(new PathRefusedError(reason))).toEqual({ status: 400, code: 'path-refused', params: { reason } });
  });

  it('rethrows anything else', () => {
    const error = new Error('disk on fire');
    expect(answer(error)).toBe(error);
  });
});
