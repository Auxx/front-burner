import type { Request, Response } from 'express';
import type { AuthTokenResult, AuthTokenService } from './auth-token.service';
import { AuthMiddleware } from './auth.middleware';
import type { SessionService } from './session.service';

describe('AuthMiddleware', () => {
  let result: AuthTokenResult;
  let active: boolean;
  let verify: ReturnType<typeof vi.fn>;
  let middleware: AuthMiddleware;

  async function run(authorization: string | undefined): Promise<Request> {
    const req = { headers: authorization === undefined ? {} : { authorization } } as Request;
    const next = vi.fn();
    await middleware.use(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
    return req;
  }

  beforeEach(() => {
    result = { ok: true, userId: 7, sessionId: 'session-1', expiresAt: 1_800_000_000_000 };
    active = true;
    verify = vi.fn(() => Promise.resolve(result));
    middleware = new AuthMiddleware(
      { verify } as unknown as AuthTokenService,
      {
        isActive: (sessionId: string, userId: number) => active && sessionId === 'session-1' && userId === 7
      } as unknown as SessionService
    );
  });

  it('sets req.auth for a valid token', async () => {
    const req = await run('Bearer the-token');
    expect(verify).toHaveBeenCalledWith('the-token');
    expect(req.auth).toEqual({ userId: 7, sessionId: 'session-1', authTokenExpiresAt: 1_800_000_000_000 });
    expect(req.authFailure).toBeUndefined();
  });

  it('leaves a request without a token alone', async () => {
    const req = await run(undefined);
    expect(req.auth).toBeUndefined();
    expect(req.authFailure).toBeUndefined();
  });

  it('ignores a non-Bearer header', async () => {
    const req = await run('Basic dXNlcjpwYXNz');
    expect(verify).not.toHaveBeenCalled();
    expect(req.auth).toBeUndefined();
    expect(req.authFailure).toBeUndefined();
  });

  it('marks an expired token', async () => {
    result = { ok: false, reason: 'expired' };
    const req = await run('Bearer the-token');
    expect(req.auth).toBeUndefined();
    expect(req.authFailure).toBe('expired');
  });

  it('marks the token of an inactive session as invalid', async () => {
    active = false;
    const req = await run('Bearer the-token');
    expect(req.auth).toBeUndefined();
    expect(req.authFailure).toBe('invalid');
  });
});
