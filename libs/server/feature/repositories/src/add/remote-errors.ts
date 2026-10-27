import { GitOperationError } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type { RepositoryCredentials } from '@front-burner/shared-contracts';

export interface RemoteErrorContext {
  host: string;
  credentialsMode: RepositoryCredentials['mode'];
  /** The credentials are a key Front Burner generated (AR-29). */
  generatedKey: boolean;
}

const onField = (path: string, code: string, params: Record<string, unknown> = {}) =>
  ApiErrorException.forFields([ { path, code, params } ]);

/**
 * The only mapping from a failed access check to an API answer (AR-42). The
 * answer carries codes and parameters, never git's output; the web client
 * owns the messages.
 */
export function toAddRepositoryError(error: GitOperationError, context: RemoteErrorContext): ApiErrorException {
  const host = error.params['host'] ?? context.host;
  switch (error.code) {
    case 'host-unreachable':
      return onField('remoteUrl', 'host-unreachable', { host });
    case 'timeout':
      return new ApiErrorException(504, 'remote-timeout', { host }, `${host} didn't answer in time.`);
    case 'tls-untrusted':
    case 'repository-not-found':
      return onField('remoteUrl', error.code);
    case 'host-key-changed':
      return onField('remoteUrl', 'host-key-changed', { host });
    case 'auth-failed':
      return context.credentialsMode === 'none'
        ? onField('credentials', 'credentials-required')
        : onField('credentials', 'credentials-refused', { generatedKey: context.generatedKey });
    case 'branch-not-found':
      return onField('branch', 'branch-not-found');
    case 'host-key-unknown': {
      const { port, type, key, fingerprint } = error.params;
      return new ApiErrorException(
        409,
        'host-key-unknown',
        { host, port: Number(port), type, key, fingerprint },
        'The server\'s host key is not known yet.'
      );
    }
    default:
      return new ApiErrorException(502, 'remote-failed', {}, 'Something went wrong while contacting the remote.');
  }
}
