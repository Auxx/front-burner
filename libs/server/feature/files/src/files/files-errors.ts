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

/** The entry exists but this action is not allowed on it (FB-23, FB-35). */
export const entryNotRenamable = () => new ApiErrorException(400, 'entry-not-renamable', {}, 'This can\'t be renamed.');

/** The root folder or a submodule, or a folder that holds one (FB-23, FB-37). */
export const entryNotDeletable = () => new ApiErrorException(400, 'entry-not-deletable', {}, 'This can\'t be deleted.');

/** Only Markdown files can be read or saved through the editor's API (ED-2, FB-21). */
export const entryNotEditable = () => new ApiErrorException(400, 'entry-not-editable');

/** Over the editor's limit, as stored (ED-2, ED-19, NF-1.5). */
export const fileTooLarge = (limit: number) => new ApiErrorException(413, 'file-too-large', { limit });

/** Not valid UTF-8, so editing it could corrupt it (ED-2, FB-21). */
export const fileNotUtf8 = () => new ApiErrorException(422, 'file-not-utf8');

/** **Recreate it** found a file at the path (ED-21). */
export const entryExists = () => new ApiErrorException(409, 'entry-exists');
