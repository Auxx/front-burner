import type { FieldTree } from '@angular/forms/signals';
import type { ApiError } from '@front-burner/shared-contracts';
import {
  credentialsErrorKey,
  credentialsFailureKey,
  type FailureText,
  type FieldErrorText,
  isCredentialsPath,
  shownFieldError
} from '@front-burner/web-repository-dialogs';

/**
 * The codes each field of the page's own sections has a text for, under
 * `web-feature-repositories.errors.<field>.<code>`: the form's own checks and
 * the backend's field codes (AR-9, AR-10, AR-14, AR-15, AR-42). The
 * credentials are not here: their section comes from `web-repository-dialogs`
 * and has its texts there.
 */
const FIELD_CODES: Readonly<Record<string, readonly string[]>> = {
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
 * The key of the text for `code` on the field at `path`: for the credentials,
 * relative to `web-repository-dialogs.errors`, where their section shows it
 * ({@link credentialsErrorKey}); for any other field, relative to
 * `web-feature-repositories.errors`, with `invalid` for a code the field has
 * no text for, such as one newer than the client.
 */
function fieldErrorKey(path: string, code: string): string {
  if (isCredentialsPath(path)) {
    return credentialsErrorKey(path, code);
  }
  return FIELD_CODES[path]?.includes(code) ? `${path}.${code}` : 'invalid';
}

/**
 * A field's first error on one of the page's own sections, once the field is
 * touched or the form submitted (AR-6); its key is relative to
 * `web-feature-repositories.errors`.
 */
export function shownError(field: FieldTree<unknown>, path: string): FieldErrorText | undefined {
  return shownFieldError(field, code => fieldErrorKey(path, code));
}

/**
 * The one place where a failed access check or submit becomes the texts of
 * AR-42: each field failure on its field, any other failure above the
 * buttons. A field failure's key is relative to the `errors` of the texts of
 * the section that shows the field: `web-repository-dialogs.errors` for the
 * credentials ({@link credentialsFailureKey}), `web-feature-repositories.errors`
 * for the rest.
 */
export function failureTexts(error: ApiError): FailureText[] {
  if (error.fields !== undefined && error.fields.length > 0) {
    return error.fields.map(({ path, code, params }) => ({
      path,
      key: isCredentialsPath(path) ? credentialsFailureKey(path, code, params) : fieldErrorKey(path, code),
      params
    }));
  }
  return [ { path: null, key: FORM_CODES.includes(error.code) ? `form.${error.code}` : null, params: error.params } ];
}
