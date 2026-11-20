import { urlForLog } from './request-url';

describe('urlForLog', () => {
  it('keeps an API path that a route answered and drops its query', () => {
    expect(urlForLog('/api/v1/repositories/1/files/file?path=private/diary.md', true)).toBe(
      '/api/v1/repositories/1/files/file'
    );
    expect(urlForLog('/api/v1/auth/oidc/callback?code=secret-code&state=s', true)).toBe('/api/v1/auth/oidc/callback');
    expect(urlForLog('/API/health/ready', true)).toBe('/API/health/ready');
  });

  it('keeps only three segments of an API path that no route answered', () => {
    expect(urlForLog('/api/v1/repositories/1/files/private/diary.md')).toBe('/api/v1/repositories/…');
    expect(urlForLog('/api/../repositories/1/files/x.md')).toBe('/api/../repositories/…');
    expect(urlForLog('/api/v1/me')).toBe('/api/v1/me');
  });

  it('keeps only the first segment of a web client path', () => {
    expect(urlForLog('/repositories/1/files/private/diary.md')).toBe('/repositories/…');
    expect(urlForLog('/assets/icons.svg?v=1.4.2')).toBe('/assets/…');
    expect(urlForLog('/login/oidc?code=secret-code')).toBe('/login/…');
  });

  it('keeps a one-segment path without its query or fragment', () => {
    expect(urlForLog('/login?next=/repositories/1/files/a.md')).toBe('/login');
    expect(urlForLog('/main-abc123.js#x')).toBe('/main-abc123.js');
    expect(urlForLog('/')).toBe('/');
    expect(urlForLog('/repositories/')).toBe('/repositories/');
  });

  it('cuts the path of a full URL and keeps its origin', () => {
    expect(urlForLog('http://instance/repositories/1/files/private/diary.md')).toBe('http://instance/repositories/…');
    expect(urlForLog('https://idp.example.com/authorize?client_id=c&state=secret-state')).toBe(
      'https://idp.example.com/authorize'
    );
    expect(urlForLog('http://instance/api/v1/repositories/1/files/file?path=a.md', true)).toBe(
      'http://instance/api/v1/repositories/1/files/file'
    );
  });

  it('logs only a placeholder for a target that is neither a path nor a URL', () => {
    expect(urlForLog('*')).toBe('/…');
    expect(urlForLog('private/diary.md')).toBe('/…');
  });
});
