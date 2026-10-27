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
  private readonly entries = new Map<string, CompletedOidcLogin & { issuedAt: number; }>();

  issue(login: CompletedOidcLogin): string {
    this.prune();
    const code = randomBytes(32).toString('base64url');
    this.entries.set(code, { ...login, issuedAt: Date.now() });
    return code;
  }

  take(code: string): CompletedOidcLogin | undefined {
    const entry = this.entries.get(code);
    this.entries.delete(code);
    if (entry === undefined || Date.now() - entry.issuedAt > TTL_MS) {
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
