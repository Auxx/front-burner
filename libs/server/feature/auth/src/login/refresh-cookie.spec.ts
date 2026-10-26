import type { Request } from 'express';
import { readRefreshToken, REFRESH_COOKIE } from './refresh-cookie';

function requestWith(options: { cookie?: string; headers?: Record<string, string>; }): Request {
  const headers: Record<string, string> = { host: 'notes.example', ...options.headers };
  return {
    cookies: options.cookie === undefined ? {} : { [REFRESH_COOKIE]: options.cookie },
    protocol: 'https',
    get: (name: string) => headers[name.toLowerCase()]
  } as unknown as Request;
}

const codeOf = (read: () => unknown) => {
  try {
    read();
  } catch (error) {
    return (error as { code?: string; }).code;
  }
  return undefined;
};

describe('readRefreshToken', () => {
  it('reads the body', () => {
    expect(readRefreshToken(requestWith({}), { refreshToken: 'a.b' })).toBe('a.b');
  });

  it('answers undefined without a token', () => {
    expect(readRefreshToken(requestWith({}), {})).toBeUndefined();
  });

  it('reads the cookie with the header and no Origin', () => {
    const req = requestWith({ cookie: 'a.b', headers: { 'x-front-burner-refresh': '1' } });
    expect(readRefreshToken(req, {})).toBe('a.b');
  });

  it('reads the cookie with the header and the same Origin', () => {
    const req = requestWith({
      cookie: 'a.b',
      headers: { 'x-front-burner-refresh': '1', origin: 'https://notes.example' }
    });
    expect(readRefreshToken(req, {})).toBe('a.b');
  });

  it('refuses the cookie without the header or with another value', () => {
    expect(codeOf(() => readRefreshToken(requestWith({ cookie: 'a.b' }), {}))).toBe('cross-site-refused');
    const other = requestWith({ cookie: 'a.b', headers: { 'x-front-burner-refresh': 'yes' } });
    expect(codeOf(() => readRefreshToken(other, {}))).toBe('cross-site-refused');
  });

  it('refuses another origin, scheme or port', () => {
    for (const origin of [ 'https://evil.example', 'http://notes.example', 'https://notes.example:8443', 'null' ]) {
      const req = requestWith({ cookie: 'a.b', headers: { 'x-front-burner-refresh': '1', origin } });
      expect(codeOf(() => readRefreshToken(req, {}))).toBe('cross-site-refused');
    }
  });

  it('refuses a token in both', () => {
    const req = requestWith({ cookie: 'a.b', headers: { 'x-front-burner-refresh': '1' } });
    expect(codeOf(() => readRefreshToken(req, { refreshToken: 'a.b' }))).toBe('malformed-request');
  });
});
