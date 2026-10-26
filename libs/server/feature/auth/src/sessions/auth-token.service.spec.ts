import type { Config } from '@front-burner/server-core-config';
import { decodeJwt, SignJWT } from 'jose';
import { AuthTokenService } from './auth-token.service';

const SECRET = 'auth-token-spec-secret-0123456789abcdefghijklmn';
const OTHER_SECRET = 'another-auth-token-secret-0123456789abcdefghijk';
const NOW = new Date('2026-10-26T12:00:00Z');
const claims = { userId: 7, sessionId: 'session-1', tokenId: 'token-1' };

const service = (secret = SECRET) => new AuthTokenService({ jwtSecret: secret } as Config);
const inMinutes = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe('AuthTokenService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ 'Date' ] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('signs only sub, sid, jti, iat and exp', async () => {
    const token = await service().sign(claims, inMinutes(15));
    expect(decodeJwt(token)).toEqual({
      sub: '7',
      sid: 'session-1',
      jti: 'token-1',
      iat: NOW.getTime() / 1000,
      exp: inMinutes(15).getTime() / 1000
    });
  });

  it('verifies its own token', async () => {
    const token = await service().sign(claims, inMinutes(15));
    expect(await service().verify(token)).toEqual({ ok: true, userId: 7, sessionId: 'session-1' });
  });

  it('refuses an auth token with another algorithm', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const payload = { sub: '7', sid: 'session-1', jti: 'token-1', iat: NOW.getTime() / 1000, exp: 9_999_999_999 };
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`;
    const hs512 = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS512' })
      .sign(new TextEncoder().encode(SECRET));

    expect(await service().verify(unsigned)).toEqual({ ok: false, reason: 'invalid' });
    expect(await service().verify(hs512)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('reports an expired token as expired', async () => {
    const token = await service().sign(claims, inMinutes(15));
    vi.setSystemTime(inMinutes(16));
    expect(await service().verify(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('reports a token signed with another secret as expired', async () => {
    const token = await service(OTHER_SECRET).sign(claims, inMinutes(15));
    expect(await service().verify(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('reports an expired token with another secret as expired too', async () => {
    // LG-64: a tab left open across the secret change must refresh, not log out.
    const token = await service(OTHER_SECRET).sign(claims, inMinutes(15));
    vi.setSystemTime(inMinutes(16));
    expect(await service().verify(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('reports a token without exp and a bad signature as invalid', async () => {
    const token = await new SignJWT({ sub: '7', sid: 'session-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode(OTHER_SECRET));
    expect(await service().verify(token)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('reports garbage as invalid', async () => {
    for (const token of [ '', 'abc', 'a.b.c' ]) {
      expect(await service().verify(token)).toEqual({ ok: false, reason: 'invalid' });
    }
  });
});
