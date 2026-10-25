import { contentSecurityPolicy, createNonce } from './csp';

describe('contentSecurityPolicy', () => {
  it('builds NF-11.1\'s policy', () => {
    expect(contentSecurityPolicy('abc')).toBe(
      'default-src \'none\'; script-src \'self\'; style-src \'self\' \'nonce-abc\'; '
        + 'img-src \'self\' blob: data: https:; connect-src \'self\'; font-src \'self\'; '
        + 'manifest-src \'self\'; worker-src \'self\'; base-uri \'self\'; form-action \'self\'; '
        + 'frame-ancestors \'none\'; object-src \'none\'; require-trusted-types-for \'script\''
    );
  });

  it('creates a fresh nonce', () => {
    const first = createNonce();
    const second = createNonce();
    expect(first).not.toBe(second);
    expect(Buffer.from(first, 'base64')).toHaveLength(16);
    expect(Buffer.from(second, 'base64')).toHaveLength(16);
  });
});
