import { CONFIG, Config } from '@front-burner/server-core-config';
import { DATABASE, Database, Session, sessions, users } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { constantTimeEquals, SessionLifecycle } from '@front-burner/server-core-security';
import type { RefreshTokenDelivery, SessionTokens } from '@front-burner/shared-contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { AuthTokenService } from './auth-token.service';
import { SessionCache } from './session-cache';

/** Injection token of the {@link SessionReuseHandler}. */
export const SESSION_REUSE_HANDLER = 'front-burner:session-reuse-handler';

/** Called when a rotated refresh token is used again, after its session was revoked (LG-36). */
export type SessionReuseHandler = (session: Session) => void;

export interface IssuedSession {
  sessionId: string;
  delivery: RefreshTokenDelivery;
  /** The response body; `refreshToken` is set only for body delivery. */
  tokens: SessionTokens;
  refreshToken: string;
}

const randomId = (bytes: number) => randomBytes(bytes).toString('base64url');
const hashOf = (refreshToken: string) => createHash('sha256').update(refreshToken, 'utf8').digest('hex');

/** The session ID part of `<session id>.<secret>`, or undefined when malformed. */
function sessionIdOf(refreshToken: string): string | undefined {
  const parts = refreshToken.split('.');
  return parts.length === 2 && parts[0] !== '' && parts[1] !== '' ? parts[0] : undefined;
}

/**
 * Starts, refreshes and revokes sessions (LG-27 to LG-39). The refresh token
 * is `<session id>.<256 random bits>`; only its SHA-256 is stored, so a
 * rotated token still finds its session and its reuse revokes it (LG-36).
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly cache = new SessionCache();

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CONFIG) private readonly config: Config,
    private readonly authTokens: AuthTokenService,
    @Inject(SESSION_REUSE_HANDLER) private readonly onReuse: SessionReuseHandler,
    private readonly events: EventsHub,
    private readonly lifecycle: SessionLifecycle
  ) {}

  start(
    user: { id: number; },
    loginMethod: 'password' | 'oidc',
    delivery: RefreshTokenDelivery
  ): Promise<IssuedSession> {
    const now = new Date();
    const id = randomId(16);
    const refreshToken = `${id}.${randomId(32)}`;
    const authTokenId = randomId(16);
    const expiresAt = new Date(now.getTime() + this.config.refreshTokenTtlMs);
    this.database.db.insert(sessions).values({
      id,
      userId: user.id,
      loginMethod,
      refreshTokenDelivery: delivery,
      refreshTokenHash: hashOf(refreshToken),
      authTokenId,
      createdAt: now,
      lastUsedAt: now,
      expiresAt
    }).run();
    this.cache.set(id, { userId: user.id, expiresAt: expiresAt.getTime(), revoked: false });
    return this.issue({ id, userId: user.id, delivery, expiresAt, authTokenId, refreshToken });
  }

  /** @throws ApiErrorException `refresh-refused` (401) for any token that cannot be used. */
  async refresh(refreshToken: string): Promise<IssuedSession> {
    const id = sessionIdOf(refreshToken);
    const session = id === undefined
      ? undefined
      : this.database.db.select().from(sessions).where(eq(sessions.id, id)).get();
    const now = new Date();
    if (session === undefined || session.revokedAt !== null || session.expiresAt <= now) {
      throw refused();
    }
    if (!constantTimeEquals(hashOf(refreshToken), session.refreshTokenHash)) {
      this.revoke(session.id);
      this.logger.warn({ sessionId: session.id }, 'A rotated refresh token was used again; the session is revoked');
      this.onReuse(session);
      throw refused();
    }
    const user = this.database.db.select({ disabled: users.disabled }).from(users).where(eq(users.id, session.userId))
      .get();
    if (user === undefined || user.disabled) {
      throw refused();
    }

    const rotated = `${session.id}.${randomId(32)}`;
    const authTokenId = randomId(16);
    // The old hash in the condition makes a concurrent refresh with the same token lose.
    const updated = this.database.db.update(sessions)
      .set({ refreshTokenHash: hashOf(rotated), authTokenId, lastUsedAt: now })
      .where(and(eq(sessions.id, session.id), eq(sessions.refreshTokenHash, session.refreshTokenHash)))
      .run();
    if (updated.changes !== 1) {
      throw refused();
    }
    return this.issue({
      id: session.id,
      userId: session.userId,
      delivery: session.refreshTokenDelivery,
      expiresAt: session.expiresAt,
      authTokenId,
      refreshToken: rotated
    });
  }

  /** Logout (LG-39): unknown, malformed or non-matching tokens are ignored. */
  revokeByRefreshToken(refreshToken: string): void {
    const id = sessionIdOf(refreshToken);
    if (id === undefined) {
      return;
    }
    const session = this.database.db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (session !== undefined && constantTimeEquals(hashOf(refreshToken), session.refreshTokenHash)) {
      this.revoke(session.id);
    }
  }

  /** Revokes every session of a user (LG-25, LG-57). */
  revokeAllOf(userId: number): void {
    const revoked = this.database.db.update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id })
      .all();
    for (const { id } of revoked) {
      this.ended(id);
    }
  }

  /** Whether a session is unrevoked, unexpired and the user's; the cache first, then the database (A-7.2). */
  isActive(sessionId: string, userId: number): boolean {
    let cached = this.cache.get(sessionId);
    if (cached === undefined) {
      const session = this.database.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
      if (session === undefined) {
        return false;
      }
      cached = { userId: session.userId, expiresAt: session.expiresAt.getTime(), revoked: session.revokedAt !== null };
      this.cache.set(sessionId, cached);
    }
    return !cached.revoked && cached.userId === userId && cached.expiresAt > Date.now();
  }

  private revoke(sessionId: string): void {
    this.database.db.update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .run();
    this.ended(sessionId);
  }

  /** A revoked session keeps no open push channel (A-7.2) and no key unlock (AR-31). */
  private ended(sessionId: string): void {
    this.cache.delete(sessionId);
    this.events.closeSession(sessionId);
    this.lifecycle.notifyRevoked(sessionId);
  }

  private async issue(session: {
    id: string;
    userId: number;
    delivery: RefreshTokenDelivery;
    expiresAt: Date;
    authTokenId: string;
    refreshToken: string;
  }): Promise<IssuedSession> {
    // JWT times are whole seconds; the session's expiry caps the auth token's.
    const authTokenExpiresAt = new Date(
      Math.floor(Math.min(Date.now() + this.config.authTokenTtlMs, session.expiresAt.getTime()) / 1000) * 1000
    );
    const authToken = await this.authTokens.sign(
      { userId: session.userId, sessionId: session.id, tokenId: session.authTokenId },
      authTokenExpiresAt
    );
    return {
      sessionId: session.id,
      delivery: session.delivery,
      refreshToken: session.refreshToken,
      tokens: {
        authToken,
        authTokenExpiresAt: authTokenExpiresAt.toISOString(),
        refreshTokenExpiresAt: session.expiresAt.toISOString(),
        ...(session.delivery === 'body' ? { refreshToken: session.refreshToken } : {})
      }
    };
  }
}

function refused(): ApiErrorException {
  return new ApiErrorException(401, 'refresh-refused');
}
