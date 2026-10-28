import { ApiErrorException } from '@front-burner/server-core-observability';
import { PathRefusedError } from '@front-burner/server-core-storage';

/**
 * The only mapping from a refused client path to an API answer: a missing
 * entry is `404 entry-not-found`, any other refusal `400 path-refused` with
 * its reason (FB-5, A-7.6). Anything else is rethrown.
 */
export function toFilesError(error: unknown): never {
  if (error instanceof PathRefusedError) {
    if (error.reason === 'not-found') {
      throw new ApiErrorException(404, 'entry-not-found');
    }
    throw new ApiErrorException(400, 'path-refused', { reason: error.reason });
  }
  throw error;
}
