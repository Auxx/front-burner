import type { ApiError, FieldError } from '@front-burner/shared-contracts';

import { failureTexts } from './add-repository-errors';

function fields(...errors: FieldError[]): ApiError {
  return { code: 'validation-failed', params: {}, requestId: 'r', message: 'm', fields: errors };
}

function apiError(code: string, params: Record<string, unknown> = {}): ApiError {
  return { code, params, requestId: 'r', message: 'm' };
}

// The English texts are checked by the web application's translations spec.
describe('failureTexts', () => {
  it.each([
    [ 'remoteUrl', 'host-unreachable', { host: 'git.example.com' }, 'remoteUrl.host-unreachable' ],
    [ 'remoteUrl', 'tls-untrusted', {}, 'remoteUrl.tls-untrusted' ],
    [ 'remoteUrl', 'repository-not-found', {}, 'remoteUrl.repository-not-found' ],
    [ 'remoteUrl', 'host-key-changed', { host: 'git.example.com' }, 'remoteUrl.host-key-changed' ],
    [ 'credentials', 'credentials-refused', { generatedKey: false }, 'credentials.credentials-refused' ],
    [ 'credentials', 'credentials-refused', { generatedKey: true }, 'credentials.credentials-refused-generated' ],
    [ 'credentials', 'credentials-required', {}, 'credentials.credentials-required' ],
    [ 'credentials.passphrase', 'wrong-passphrase', {}, 'credentials.passphrase.wrong-passphrase' ],
    [ 'credentials.privateKey', 'unsupported-type', {}, 'credentials.privateKey.unsupported-type' ],
    [ 'credentials.name', 'name-taken', {}, 'credentials.name.name-taken' ],
    [ 'branch', 'branch-not-found', {}, 'branch.branch-not-found' ],
    [ 'branch', 'no-branches', {}, 'branch.no-branches' ],
    [ 'name', 'name-taken', { name: 'handbook' }, 'name.name-taken' ],
    [ 'gitLevel', 'level-not-allowed', {}, 'gitLevel.level-not-allowed' ]
  ])('shows %s %s on its field', (path, code, params, key) => {
    expect(failureTexts(fields({ path, code, params }))).toEqual([ { path, key, params } ]);
  });

  it.each([
    [ 'remote-timeout', { host: 'git.example.com' } ],
    [ 'remote-failed', {} ],
    [ 'rate-limited', {} ]
  ])('shows %s above the buttons', (code, params) => {
    expect(failureTexts(apiError(code, params))).toEqual([ { path: null, key: `form.${code}`, params } ]);
  });

  it('leaves any other failure to the API\'s general texts', () => {
    expect(failureTexts(apiError('network'))).toEqual([ { path: null, key: null, params: {} } ]);
  });

  it('gives a field code it has no text for the generic text', () => {
    expect(failureTexts(fields({ path: 'remoteUrl', code: 'brand-new', params: {} }))).toEqual([
      { path: 'remoteUrl', key: 'invalid', params: {} }
    ]);
  });

  it('shows every field failure', () => {
    const failures = failureTexts(fields(
      { path: 'name', code: 'name-taken', params: { name: 'handbook' } },
      { path: 'credentials.name', code: 'name-taken', params: {} }
    ));

    expect(failures.map(failure => failure.path)).toEqual([ 'name', 'credentials.name' ]);
  });
});
