import type { FieldTree, ValidationError } from '@angular/forms/signals';
import { fieldErrorCode } from '@front-burner/web-core';

/** The codes each field has a text for, by the field's path as the API names it. */
export type FieldCodes = Readonly<Record<string, readonly string[]>>;

/**
 * The codes each field of the credentials has a text for, under
 * `web-repository-dialogs.errors.<field>.<code>`: the form's own checks and
 * the backend's field codes (AR-22, AR-42).
 */
export const CREDENTIALS_FIELD_CODES: FieldCodes = {
  credentials: [
    'credentials-refused',
    'credentials-refused-generated',
    'credentials-required',
    'kind-mismatch',
    'protocol-mismatch'
  ],
  'credentials.savedId': [ 'required' ],
  'credentials.name': [ 'too-small', 'too-big', 'name-taken' ],
  'credentials.username': [ 'too-small', 'too-big' ],
  'credentials.password': [ 'too-small', 'too-big' ],
  'credentials.privateKey': [
    'too-small',
    'too-big',
    'invalid-key',
    'unsupported-type',
    'rsa-too-short',
    'passphrase-required',
    'kdf-rounds-too-high'
  ],
  'credentials.passphrase': [
    'required',
    'too-big',
    'wrong-passphrase',
    'passphrase-required',
    'passphrase-not-needed',
    'unlock-failed',
    'unlock-too-many-attempts'
  ],
  'credentials.generateName': [ 'too-small', 'too-big', 'name-taken', 'generate-failed' ]
};

/** Where a failure of a request is shown, and with which text. */
export interface FailureText {
  /** The field it belongs to, as the API names it; `null` for above the buttons (AR-6). */
  readonly path: string | null;
  /**
   * The key, relative to the `errors` of the form's texts, of its text;
   * `null` for the API's general text of the code (`ApiErrorTextService`).
   */
  readonly key: string | null;
  readonly params: Record<string, unknown>;
}

/** The text of a field error: its key, relative to the `errors` of the form's texts, and parameters. */
export interface FieldErrorText {
  readonly key: string;
  readonly params: Record<string, unknown>;
}

/**
 * The key, relative to the `errors` of the form's texts, of the text for
 * `code` on the field at `path`; `invalid` for a code the field has no text
 * for, such as one newer than the client.
 */
export function fieldErrorKey(path: string, code: string, codes: FieldCodes = CREDENTIALS_FIELD_CODES): string {
  return codes[path]?.includes(code) ? `${path}.${code}` : 'invalid';
}

/**
 * A field's first error, once the field is touched or the form submitted
 * (AR-6). An error may carry the parameters of its text in `params`, as the
 * API's field errors do.
 */
export function shownError(
  field: FieldTree<unknown>,
  path: string,
  codes: FieldCodes = CREDENTIALS_FIELD_CODES
): FieldErrorText | undefined {
  const state = field();
  const error: ValidationError | undefined = state.touched() ? state.errors()[0] : undefined;
  if (!error) {
    return undefined;
  }
  const params = (error as { params?: unknown; }).params;
  return {
    key: fieldErrorKey(path, fieldErrorCode(error), codes),
    params: typeof params === 'object' && params !== null ? params as Record<string, unknown> : {}
  };
}
