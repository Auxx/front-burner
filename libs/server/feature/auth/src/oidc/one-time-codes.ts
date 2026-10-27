import { constantTimeEquals } from '@front-burner/server-core-security';
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

/** A completed OIDC login, waiting for the web client to exchange its code (LG-22). */
export interface CompletedOidcLogin {
  userId: number;
  issuer: string;
  subject: string;
  email: string | undefined;
}

const TTL_MS = 60_000;

/** The one-time codes of LG-22: valid 60 seconds, once; in memory only. */
@Injectable()
export class OneTimeCodes {
  private readonly entries = new Map<string, CompletedOidcLogin & { issuedAt: number; binding: string; }>();

  /**
   * @param binding A secret that only the browser that completed the login
   *   holds (in a cookie), so that nobody can hand their code to another
   *   browser and log it in to their own account (login CSRF).
   */
  issue(login: CompletedOidcLogin, binding: string): string {
    this.prune();
    const code = randomBytes(32).toString('base64url');
    this.entries.set(code, { ...login, issuedAt: Date.now(), binding });
    return code;
  }

  /** The login of a code, once: a wrong binding also uses it up. */
  take(code: string, binding: string | undefined): CompletedOidcLogin | undefined {
    const entry = this.entries.get(code);
    this.entries.delete(code);
    if (
      entry === undefined || binding === undefined || !constantTimeEquals(binding, entry.binding)
      || Date.now() - entry.issuedAt > TTL_MS
    ) {
      return undefined;
    }
    return { userId: entry.userId, issuer: entry.issuer, subject: entry.subject, email: entry.email };
  }

  private prune(): void {
    const now = Date.now();
    for (const [ code, entry ] of this.entries) {
      if (now - entry.issuedAt <= TTL_MS) {
        break;
      }
      this.entries.delete(code);
    }
  }
}
