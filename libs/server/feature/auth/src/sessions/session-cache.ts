export interface CachedSession {
  userId: number;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  revoked: boolean;
}

/**
 * The sessions checked on every authenticated request, kept in memory so that
 * a request needs no query (A-7.2). One backend process owns them.
 */
export class SessionCache {
  private readonly sessions = new Map<string, CachedSession>();

  get(id: string): CachedSession | undefined {
    return this.sessions.get(id);
  }

  set(id: string, value: CachedSession): void {
    this.sessions.set(id, value);
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}
