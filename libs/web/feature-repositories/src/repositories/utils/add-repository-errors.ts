import type { FieldTree } from '@angular/forms/signals';
import type { ApiError } from '@front-burner/shared-contracts';
import {
  CREDENTIALS_FIELD_CODES,
  type FailureText,
  type FieldCodes,
  fieldErrorKey as credentialsFieldErrorKey,
  type FieldErrorText,
  shownError as credentialsShownError
} from '@front-burner/web-repository-dialogs';

/**
 * The codes each field of the form has a text for, under
 * `web-feature-repositories.errors.<field>.<code>`: the form's own checks and
 * the backend's field codes (AR-9, AR-10, AR-14, AR-15, AR-42). The
 * credentials' texts are under `web-repository-dialogs.errors`, where their
 * section shows them.
 */
const FIELD_CODES: FieldCodes = {
  ...CREDENTIALS_FIELD_CODES,
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
  branch: [ 'required', 'branch-not-found', 'no-branches' ],
  understood: [ 'required' ],
  gitLevel: [ 'level-not-allowed' ]
};

/** The failures shown above the buttons with a text of the form's own (AR-42, AR-55). */
const FORM_CODES: readonly string[] = [ 'remote-timeout', 'remote-failed', 'rate-limited' ];

/**
 * The key, relative to `web-feature-repositories.errors`, of the text for
 * `code` on the field at `path`; `invalid` for a code the field has no text
 * for, such as one newer than the client.
 */
export function fieldErrorKey(path: string, code: string): string {
  return credentialsFieldErrorKey(path, code, FIELD_CODES);
}

/**
 * A field's first error, once the field is touched or the form submitted
 * (AR-6); its key is relative to `web-feature-repositories.errors`.
 */
export function shownError(field: FieldTree<unknown>, path: string): FieldErrorText | undefined {
  return credentialsShownError(field, path, FIELD_CODES);
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
