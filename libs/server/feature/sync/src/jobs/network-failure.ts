import type { GitOperationError } from '@front-burner/server-core-git';
import type { GitJobFailed } from '@front-burner/shared-contracts';

/**
 * The API's code for a network step that git refused or could not do (GA-30,
 * GA-31, RC-4, RC-5, CA-15). Text for each is under `errors.<code>`.
 */
function failureCode(error: GitOperationError, hasCredentials: boolean): string {
  switch (error.code) {
    case 'auth-failed':
      return hasCredentials ? 'credentials-refused' : 'no-credentials';
    case 'timeout':
      return 'remote-timeout';
    case 'push-non-fast-forward':
    case 'push-not-allowed':
    case 'push-protected-branch':
    case 'push-unsigned':
    case 'push-rejected':
    case 'host-unreachable':
    case 'tls-untrusted':
    case 'repository-not-found':
    case 'host-key-changed':
    case 'host-key-unknown':
      return error.code;
    default:
      return 'remote-failed';
  }
}

/**
 * The finished result of a network job that git refused: a job that ended, not
 * one that went wrong in the runner. `params` are the job's own, and git's
 * (such as the remote's lines) follow them.
 */
export function networkFailure(
  error: GitOperationError,
  hasCredentials: boolean,
  params: Record<string, string> = {}
): GitJobFailed {
  return { kind: 'failed', code: failureCode(error, hasCredentials), params: { ...params, ...error.params } };
}
