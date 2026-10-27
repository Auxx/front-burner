import { Injectable } from '@nestjs/common';

/** What the callback needs to finish a login that `start` began (LG-17). */
export interface PendingLogin {
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
}

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 1000;

/** OIDC logins waiting for the provider's callback, by `state`; in memory only. */
@Injectable()
export class PendingLogins {
  // A Map keeps insertion order, so the first entries are the oldest.
  private readonly entries = new Map<string, PendingLogin & { createdAt: number; }>();

  add(state: string, login: PendingLogin): void {
    this.prune();
    while (this.entries.size >= MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    this.entries.set(state, { ...login, createdAt: Date.now() });
  }

  /** Returns the pending login and forgets it, so that it is used once. */
  take(state: string): PendingLogin | undefined {
    const entry = this.entries.get(state);
    this.entries.delete(state);
    if (entry === undefined || Date.now() - entry.createdAt > TTL_MS) {
      return undefined;
    }
    return { codeVerifier: entry.codeVerifier, nonce: entry.nonce, redirectUri: entry.redirectUri };
  }

  private prune(): void {
    const now = Date.now();
    for (const [ state, entry ] of this.entries) {
      if (now - entry.createdAt <= TTL_MS) {
        break;
      }
      this.entries.delete(state);
    }
  }
}
