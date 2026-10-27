import { redactCredentials } from './redact';

describe('redactCredentials', () => {
  it('removes credentials from URLs in git\'s output', () => {
    const stderr = [
      'fatal: unable to access \'https://user:s3cret@example.com/repo.git/\': The requested URL returned error: 403',
      'warning: redirecting to https://x-access-token:ghp_abc@github.com/o/r.git/',
      'Cloning into ssh://git@example.com:2222/o/r.git'
    ].join('\n');

    const redacted = redactCredentials(stderr);

    expect(redacted).not.toContain('s3cret');
    expect(redacted).not.toContain('ghp_abc');
    expect(redacted).not.toContain('x-access-token');
    expect(redacted).toContain('\'https://***@example.com/repo.git/\'');
    expect(redacted).toContain('https://***@github.com/o/r.git/');
    expect(redacted).toContain('ssh://***@example.com:2222/o/r.git');
  });

  it('leaves URLs without credentials and other text alone', () => {
    const text = 'Cloning into \'repo\'...\nfatal: repository \'https://example.com/a@b/\' not found';

    expect(redactCredentials(text)).toBe(text);
  });

  it('removes credentials that contain an @', () => {
    expect(redactCredentials('https://me@corp:p@ss@example.com/x')).toBe('https://***@example.com/x');
  });
});
