import { urlForLog } from './request-url';

describe('urlForLog', () => {
  it('keeps an API path and drops its query', () => {
    expect(urlForLog('/api/v1/repositories/1/files/file?path=private/diary.md')).toBe(
      '/api/v1/repositories/1/files/file'
    );
    expect(urlForLog('/api/v1/auth/oidc/callback?code=secret-code&state=s')).toBe('/api/v1/auth/oidc/callback');
    expect(urlForLog('/API/health/ready')).toBe('/API/health/ready');
  });

  it('keeps only the first segment of a web client path', () => {
    expect(urlForLog('/repositories/1/files/private/diary.md')).toBe('/repositories/…');
    expect(urlForLog('/assets/icons.svg?v=1.4.2')).toBe('/assets/…');
  });

  it('keeps a one-segment path without its query or fragment', () => {
    expect(urlForLog('/login?next=/repositories/1/files/a.md')).toBe('/login');
    expect(urlForLog('/main-abc123.js#x')).toBe('/main-abc123.js');
    expect(urlForLog('/')).toBe('/');
    expect(urlForLog('/repositories/')).toBe('/repositories/');
  });
});
