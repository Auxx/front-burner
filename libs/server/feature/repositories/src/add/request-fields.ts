import { ApiErrorException } from '@front-burner/server-core-observability';
import { type ParsedRemote, parseRemoteUrl } from '@front-burner/shared-util';

/** A `validation-failed` answer with one field error. */
export const fieldError = (path: string, code: string, params: Record<string, unknown> = {}) =>
  ApiErrorException.forFields([ { path, code, params } ]);

/**
 * A remote URL taken apart: a request's, which its schema has checked, or a
 * repository's, which was checked when it was added (AR-9).
 *
 * @throws ApiErrorException the parser's problem on `remoteUrl`.
 */
export function remoteOf(url: string): ParsedRemote {
  const result = parseRemoteUrl(url);
  if (!('remote' in result)) {
    throw fieldError('remoteUrl', result.problem);
  }
  return result.remote;
}
