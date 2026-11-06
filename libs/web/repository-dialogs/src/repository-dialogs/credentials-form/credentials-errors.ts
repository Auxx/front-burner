import type { FieldTree, ValidationError } from '@angular/forms/signals';
import { fieldErrorCode } from '@front-burner/web-core';

/**
 * The codes each field of the credentials has a text for, under
 * `web-repository-dialogs.errors.<field>.<code>`: the form's own checks and
 * the backend's field codes (AR-22, AR-42).
 */
const FIELD_CODES: Readonly<Record<string, readonly string[]>> = {
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
   * The key of its text, relative to the `errors` of the texts of the
   * component that shows the field (`web-repository-dialogs.errors` for the
   * credentials); `null` for the API's general text of the code
   * (`ApiErrorTextService`).
   */
  readonly key: string | null;
  readonly params: Record<string, unknown>;
}

/** The text of a field error: its key, relative to the `errors` of the texts that show it, and parameters. */
export interface FieldErrorText {
  readonly key: string;
  readonly params: Record<string, unknown>;
}

/** Whether `path`, as the API names it, is the credentials or one of their fields. */
export function isCredentialsPath(path: string): boolean {
  return path === 'credentials' || path.startsWith('credentials.');
}

/**
 * The key, relative to `web-repository-dialogs.errors`, of the text for
 * `code` on the credentials field at `path`; `credentials.invalid` for a code
 * the field has no text for, such as one newer than the client.
 */
export function credentialsErrorKey(path: string, code: string): string {
  return FIELD_CODES[path]?.includes(code) ? `${path}.${code}` : 'credentials.invalid';
}

/**
 * A field's first error, once the field is touched or the form submitted
 * (AR-6), with its key from `keyOf`. An error may carry the parameters of its
 * text in `params`, as the API's field errors do.
 */
export function shownFieldError(
  field: FieldTree<unknown>,
  keyOf: (code: string) => string
): FieldErrorText | undefined {
  const state = field();
  const error: ValidationError | undefined = state.touched() ? state.errors()[0] : undefined;
  if (!error) {
    return undefined;
  }
  const params = (error as { params?: unknown; }).params;
  return {
    key: keyOf(fieldErrorCode(error)),
    params: typeof params === 'object' && params !== null ? params as Record<string, unknown> : {}
  };
}

/** {@link shownFieldError} for the credentials field at `path`, keyed by {@link credentialsErrorKey}. */
export function credentialsShownError(field: FieldTree<unknown>, path: string): FieldErrorText | undefined {
  return shownFieldError(field, code => credentialsErrorKey(path, code));
}
