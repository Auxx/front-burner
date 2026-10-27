import type { FieldTree, ValidationError } from '@angular/forms/signals';
import type { ApiError } from '@front-burner/shared-contracts';

import { fieldErrorCode } from './field-error-code';

/**
 * The codes each field of the form has a text for, under
 * `web-feature-repositories.errors.<field>.<code>`: the form's own checks and
 * the backend's field codes (AR-9, AR-10, AR-14, AR-15, AR-42).
 */
const FIELD_CODES: Record<string, readonly string[]> = {
  remoteUrl: [
    'required',
    'too-long',
    'unsupported',
    'credentials-in-url',
    'empty-path',
    'query-or-fragment',
    'host-unreachable',
    'tls-untrusted',
    'repository-not-found',
    'host-key-changed'
  ],
  name: [ 'too-small', 'too-big', 'control-character', 'name-taken' ],
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
    'unlock-failed'
  ],
  'credentials.generateName': [ 'too-small', 'too-big', 'name-taken', 'generate-failed' ],
  branch: [ 'required', 'branch-not-found', 'no-branches' ],
  understood: [ 'required' ],
  gitLevel: [ 'level-not-allowed' ]
};

/** The failures shown above the buttons with a text of the form's own (AR-42, AR-55). */
const FORM_CODES: readonly string[] = [ 'remote-timeout', 'remote-failed', 'rate-limited' ];

/** Where a failure of a request is shown, and with which text. */
export interface FailureText {
  /** The field it belongs to, as the API names it; `null` for above the buttons (AR-6). */
  readonly path: string | null;
  /**
   * The key, relative to `web-feature-repositories.errors`, of its text;
   * `null` for the API's general text of the code (`ApiErrorTextService`).
   */
  readonly key: string | null;
  readonly params: Record<string, unknown>;
}

/**
 * The key, relative to `web-feature-repositories.errors`, of the text for
 * `code` on the field at `path`; `invalid` for a code the field has no text
 * for, such as one newer than the client.
 */
export function fieldErrorKey(path: string, code: string): string {
  return FIELD_CODES[path]?.includes(code) ? `${path}.${code}` : 'invalid';
}

/** The text of a field error: its key, relative to `web-feature-repositories.errors`, and parameters. */
export interface FieldErrorText {
  readonly key: string;
  readonly params: Record<string, unknown>;
}

/**
 * A field's first error, once the field is touched or the form submitted
 * (AR-6). An error may carry the parameters of its text in `params`, as the
 * API's field errors do.
 */
export function shownError(field: FieldTree<unknown>, path: string): FieldErrorText | undefined {
  const state = field();
  const error: ValidationError | undefined = state.touched() ? state.errors()[0] : undefined;
  if (!error) {
    return undefined;
  }
  const params = (error as { params?: unknown; }).params;
  return {
    key: fieldErrorKey(path, fieldErrorCode(error)),
    params: typeof params === 'object' && params !== null ? params as Record<string, unknown> : {}
  };
}

/**
 * The one place where a failed access check or submit becomes the texts of
 * AR-42: each field failure on its field, any other failure above the
 * buttons. For a generated key, refused credentials also ask whether the key
 * was added on the git server.
 */
export function failureTexts(error: ApiError): FailureText[] {
  if (error.fields !== undefined && error.fields.length > 0) {
    return error.fields.map(({ path, code, params }) => {
      const shown = code === 'credentials-refused' && params['generatedKey'] === true
        ? 'credentials-refused-generated'
        : code;
      return { path, key: fieldErrorKey(path, shown), params };
    });
  }
  return [ { path: null, key: FORM_CODES.includes(error.code) ? `form.${error.code}` : null, params: error.params } ];
}
