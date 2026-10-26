import { CONFIG, Config } from '@front-burner/server-core-config';
import { Inject, Injectable } from '@nestjs/common';
import { decodeJwt, decodeProtectedHeader, errors, jwtVerify, SignJWT } from 'jose';

const ALGORITHM = 'HS256';

export type AuthTokenResult =
  | { ok: true; userId: number; sessionId: string; }
  | { ok: false; reason: 'expired' | 'invalid'; };

/** Signs and verifies auth tokens: HS256 JWTs with the claims of LG-28 and nothing else. */
@Injectable()
export class AuthTokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(CONFIG) config: Config) {
    this.key = new TextEncoder().encode(config.jwtSecret);
  }

  sign(claims: { userId: number; sessionId: string; tokenId: string; }, expiresAt: Date): Promise<string> {
    return new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(String(claims.userId))
      .setJti(claims.tokenId)
      .setIssuedAt(Math.floor(Date.now() / 1000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
  }

  async verify(token: string): Promise<AuthTokenResult> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: [ ALGORITHM ] });
      const userId = Number(payload.sub);
      if (!Number.isSafeInteger(userId) || typeof payload['sid'] !== 'string') {
        return { ok: false, reason: 'invalid' };
      }
      return { ok: true, userId, sessionId: payload['sid'] };
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        return { ok: false, reason: 'expired' };
      }
      if (error instanceof errors.JWSSignatureVerificationFailed && this.isWellFormed(token)) {
        // A token signed with an earlier secret: refreshing helps, so users stay logged in (LG-64).
        return { ok: false, reason: 'expired' };
      }
      return { ok: false, reason: 'invalid' };
    }
  }

  private isWellFormed(token: string): boolean {
    try {
      return decodeProtectedHeader(token).alg === ALGORITHM && typeof decodeJwt(token).exp === 'number';
    } catch {
      return false;
    }
  }
}
