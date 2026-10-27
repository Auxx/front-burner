import type { FieldTree } from '@angular/forms/signals';

import { fieldErrorCode } from './field-error-code';

/**
 * The codes each field of the form has a text for, under
 * `web-feature-repositories.errors.<field>.<code>`: the form's own checks and
 * the backend's field codes (AR-9, AR-10, AR-14, AR-15, AR-42).
 */
const FIELD_CODES: Record<string, readonly string[]> = {
  remoteUrl: [ 'required', 'too-long', 'unsupported', 'credentials-in-url', 'empty-path', 'query-or-fragment' ],
  name: [ 'too-small', 'too-big', 'control-character', 'name-taken' ]
};

/**
 * The key, relative to `web-feature-repositories.errors`, of the text for
 * `code` on the field at `path`; `invalid` for a code the field has no text
 * for, such as one newer than the client.
 */
export function fieldErrorKey(path: string, code: string): string {
  return FIELD_CODES[path]?.includes(code) ? `${path}.${code}` : 'invalid';
}

/** The key of a field's first error, once the field is touched or the form submitted (AR-6). */
export function shownErrorKey(field: FieldTree<unknown>, path: string): string | undefined {
  const state = field();
  const error = state.touched() ? state.errors()[0] : undefined;
  return error ? fieldErrorKey(path, fieldErrorCode(error)) : undefined;
}
