import { GitOperationError } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';

/**
 * The only mapping from a local git operation's failure to an API answer
 * (GA-43). Anything else is rethrown.
 */
export function toGitApiError(error: unknown): never {
  if (error instanceof GitOperationError) {
    switch (error.code) {
      case 'nothing-to-commit':
        throw new ApiErrorException(409, 'nothing-to-commit');
      case 'detached-head':
        throw new ApiErrorException(409, 'detached-head');
      case 'discard-blocked':
        throw new ApiErrorException(409, 'discard-blocked');
      case 'timeout':
        throw new ApiErrorException(504, 'git-timeout');
    }
  }
  throw error;
}
