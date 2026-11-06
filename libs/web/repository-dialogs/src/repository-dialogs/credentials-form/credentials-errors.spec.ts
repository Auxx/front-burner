import { credentialsErrorKey, credentialsFailureKey, isCredentialsPath } from './credentials-errors';

// The English texts are checked by the web application's translations spec.
describe('credentialsErrorKey', () => {
  it.each([
    [ 'credentials', 'credentials-refused', 'credentials.credentials-refused' ],
    [ 'credentials.passphrase', 'wrong-passphrase', 'credentials.passphrase.wrong-passphrase' ],
    [ 'credentials.generateName', 'generate-failed', 'credentials.generateName.generate-failed' ]
  ])('gives %s %s its text', (path, code, key) => {
    expect(credentialsErrorKey(path, code)).toBe(key);
  });

  it('gives a code it has no text for the credentials\' generic text', () => {
    expect(credentialsErrorKey('credentials.privateKey', 'brand-new')).toBe('credentials.invalid');
    expect(credentialsErrorKey('credentials.username', 'wrong-passphrase')).toBe('credentials.invalid');
  });
});

describe('credentialsFailureKey', () => {
  it('asks whether a refused generated key was added on the git server', () => {
    expect(credentialsFailureKey('credentials', 'credentials-refused', { generatedKey: true })).toBe(
      'credentials.credentials-refused-generated'
    );
    expect(credentialsFailureKey('credentials', 'credentials-refused', {})).toBe('credentials.credentials-refused');
  });
});

describe('isCredentialsPath', () => {
  it.each([
    [ 'credentials', true ],
    [ 'credentials.name', true ],
    [ 'name', false ],
    [ 'credentialsName', false ]
  ])('says %s is %s', (path, expected) => {
    expect(isCredentialsPath(path)).toBe(expected);
  });
});
