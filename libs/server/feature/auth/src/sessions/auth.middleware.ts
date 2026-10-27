import '@front-burner/server-core-security';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthTokenService } from './auth-token.service';
import { SessionService } from './session.service';

const BEARER = /^Bearer (\S+)$/;

/**
 * Identifies the caller from `Authorization: Bearer <auth token>` before any
 * guard runs, so that the rate limiter can count per user (NF-11.4). It never
 * answers a request: {@link AuthGuard} refuses what needs a login (A-1.12).
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly authTokens: AuthTokenService,
    private readonly sessions: SessionService
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
    if (token !== undefined) {
      const result = await this.authTokens.verify(token);
      // `in` narrows also where strictNullChecks is off (the server app's specs).
      if ('reason' in result) {
        req.authFailure = result.reason;
      } else if (this.sessions.isActive(result.sessionId, result.userId)) {
        req.auth = { userId: result.userId, sessionId: result.sessionId, authTokenExpiresAt: result.expiresAt };
      } else {
        req.authFailure = 'invalid';
      }
    }
    next();
  }
}
