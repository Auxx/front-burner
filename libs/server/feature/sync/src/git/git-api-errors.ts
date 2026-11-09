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
      case 'amend-not-allowed':
        throw new ApiErrorException(409, 'amend-not-allowed');
      case 'discard-blocked':
        throw new ApiErrorException(409, 'discard-blocked');
      case 'branch-name-invalid':
        throw new ApiErrorException(400, 'branch-name-invalid');
      case 'branch-not-found':
        throw new ApiErrorException(409, 'branch-not-found');
      case 'branch-exists':
        throw new ApiErrorException(409, 'branch-exists');
      case 'branch-name-conflict':
        throw new ApiErrorException(409, 'branch-name-conflict');
      case 'switch-blocked':
        throw new ApiErrorException(409, 'switch-blocked');
      case 'git-busy':
        throw new ApiErrorException(409, 'git-busy');
      case 'no-commits':
        throw new ApiErrorException(409, 'no-commits');
      case 'timeout':
        throw new ApiErrorException(504, 'git-timeout');
    }
  }
  throw error;
}
