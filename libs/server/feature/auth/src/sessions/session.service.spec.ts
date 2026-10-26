import type { Config } from '@front-burner/server-core-config';
import { Database, Session, sessions, users } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { eq } from 'drizzle-orm';
import { createTestDatabase } from '../testing/test-database';
import { AuthTokenService } from './auth-token.service';
import { SessionService } from './session.service';

const NOW = new Date('2026-10-26T12:00:00Z');
const DAY = 86_400_000;
const config = {
  jwtSecret: 'session-spec-secret-0123456789abcdefghijklmnopq',
  authTokenTtlMs: 15 * 60_000,
  refreshTokenTtlMs: 30 * DAY
} as Config;

describe('SessionService', () => {
  let database: Database;
  let onReuse: ReturnType<typeof vi.fn<(session: Session) => void>>;
  let service: SessionService;
  let userId: number;

  const refused = expect.objectContaining({ code: 'refresh-refused' });
  const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ 'Date' ] });
    vi.setSystemTime(NOW);
    database = createTestDatabase();
    userId = database.db.insert(users).values({
      email: 'alice@x.io',
      displayName: 'Alice',
      role: 'administrator',
      loginMethod: 'password',
      passwordHash: '$argon2id$hash',
      createdAt: NOW
    }).returning().get().id;
    onReuse = vi.fn();
    service = new SessionService(database, config, new AuthTokenService(config), onReuse);
  });

  afterEach(() => {
    database.sqlite.close();
    vi.useRealTimers();
  });

  it('starts a session and hashes the refresh token', async () => {
    const issued = await service.start({ id: userId }, 'password', 'cookie');

    const row = database.db.select().from(sessions).get();
    expect(row).toMatchObject({
      id: issued.sessionId,
      userId,
      loginMethod: 'password',
      refreshTokenDelivery: 'cookie',
      createdAt: NOW,
      lastUsedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 30 * DAY),
      revokedAt: null
    });
    expect(row?.refreshTokenHash).not.toBe(issued.refreshToken);
    const secret = issued.refreshToken.split('.')[1] ?? '';
    expect(secret.length).toBeGreaterThanOrEqual(43);
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(issued.tokens).toEqual({
      authToken: expect.any(String),
      authTokenExpiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
      refreshTokenExpiresAt: new Date(NOW.getTime() + 30 * DAY).toISOString()
    });
    expect(service.isActive(issued.sessionId, userId)).toBe(true);
  });

  it('puts the refresh token in the body only for body delivery', async () => {
    const issued = await service.start({ id: userId }, 'password', 'body');
    expect(issued.tokens.refreshToken).toBe(issued.refreshToken);
  });

  it('rotates the refresh token', async () => {
    const first = await service.start({ id: userId }, 'password', 'cookie');
    const second = await service.refresh(first.refreshToken);

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(service.refresh(second.refreshToken)).resolves.toMatchObject({ sessionId: first.sessionId });
  });

  it('revokes the session when a rotated token is used again', async () => {
    const first = await service.start({ id: userId }, 'password', 'cookie');
    const second = await service.refresh(first.refreshToken);

    await expect(service.refresh(first.refreshToken)).rejects.toEqual(refused);

    expect(onReuse).toHaveBeenCalledWith(expect.objectContaining({ id: first.sessionId, userId }));
    await expect(service.refresh(second.refreshToken)).rejects.toEqual(refused);
    expect(service.isActive(first.sessionId, userId)).toBe(false);
  });

  it('refuses a refresh after the session expired', async () => {
    const issued = await service.start({ id: userId }, 'password', 'cookie');
    advance(30 * DAY + 1);
    await expect(service.refresh(issued.refreshToken)).rejects.toEqual(refused);
    expect(service.isActive(issued.sessionId, userId)).toBe(false);
  });

  it('does not extend the session on refresh', async () => {
    const first = await service.start({ id: userId }, 'password', 'cookie');
    advance(10 * DAY);
    const second = await service.refresh(first.refreshToken);

    expect(second.tokens.refreshTokenExpiresAt).toBe(first.tokens.refreshTokenExpiresAt);
    expect(database.db.select().from(sessions).get()?.lastUsedAt).toEqual(new Date(NOW.getTime() + 10 * DAY));
  });

  it('never issues an auth token that outlives its session', async () => {
    const first = await service.start({ id: userId }, 'password', 'cookie');
    advance(30 * DAY - 60_000);
    const second = await service.refresh(first.refreshToken);
    expect(second.tokens.authTokenExpiresAt).toBe(first.tokens.refreshTokenExpiresAt);
  });

  it('refuses the refresh of a disabled user', async () => {
    const issued = await service.start({ id: userId }, 'password', 'cookie');
    database.db.update(users).set({ disabled: true }).where(eq(users.id, userId)).run();
    await expect(service.refresh(issued.refreshToken)).rejects.toEqual(refused);
  });

  it('refuses malformed and unknown refresh tokens', async () => {
    for (const token of [ '', 'no-dot', '.x', 'x.', 'unknown.secret' ]) {
      await expect(service.refresh(token)).rejects.toBeInstanceOf(ApiErrorException);
    }
    expect(onReuse).not.toHaveBeenCalled();
  });

  it('logs out', async () => {
    const issued = await service.start({ id: userId }, 'password', 'cookie');
    service.revokeByRefreshToken(issued.refreshToken);

    expect(service.isActive(issued.sessionId, userId)).toBe(false);
    expect(database.db.select().from(sessions).get()?.revokedAt).toEqual(NOW);
    await expect(service.refresh(issued.refreshToken)).rejects.toEqual(refused);
  });

  it('logs out with an unknown token without failing', async () => {
    const issued = await service.start({ id: userId }, 'password', 'cookie');
    expect(() => service.revokeByRefreshToken('garbage')).not.toThrow();
    // The session ID alone is in every auth token; it must not be enough to log out.
    expect(() => service.revokeByRefreshToken(`${issued.sessionId}.guess`)).not.toThrow();
    expect(service.isActive(issued.sessionId, userId)).toBe(true);
  });

  it('revokes every session of a user', async () => {
    const one = await service.start({ id: userId }, 'password', 'cookie');
    const two = await service.start({ id: userId }, 'password', 'body');
    service.revokeAllOf(userId);

    expect(service.isActive(one.sessionId, userId)).toBe(false);
    expect(service.isActive(two.sessionId, userId)).toBe(false);
    await expect(service.refresh(two.refreshToken)).rejects.toEqual(refused);
  });

  it('reads an uncached session from the database', async () => {
    const issued = await service.start({ id: userId }, 'password', 'cookie');
    const restarted = new SessionService(database, config, new AuthTokenService(config), onReuse);

    expect(restarted.isActive(issued.sessionId, userId)).toBe(true);
    expect(restarted.isActive(issued.sessionId, userId + 1)).toBe(false);
    expect(restarted.isActive('unknown', userId)).toBe(false);
  });
});
