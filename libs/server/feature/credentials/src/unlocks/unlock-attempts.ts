import { ApiErrorException } from '@front-burner/server-core-observability';
import { Injectable } from '@nestjs/common';

/** Wrong passphrases allowed per key per user within the window (RC-18). */
export const UNLOCK_ATTEMPT_LIMIT = 5;
export const UNLOCK_ATTEMPT_WINDOW_MS = 60_000;

/**
 * Counts wrong passphrases per user and key in a sliding window, in memory
 * only (RC-18, A-5.5). Checked before the key's KDF runs, so that a limited
 * key costs nothing. A restart forgets the counts; the per-IP rate-limit group
 * still applies.
 */
@Injectable()
export class UnlockAttempts {
  /** `userId:keyId` → times of the wrong attempts within the window, oldest first. */
  readonly #wrong = new Map<string, number[]>();

  /** @throws ApiErrorException 429 `unlock-too-many-attempts` once the key's limit is reached. */
  assertAllowed(userId: number, keyId: number): void {
    this.forgetExpired();
    if ((this.#wrong.get(keyOf(userId, keyId))?.length ?? 0) >= UNLOCK_ATTEMPT_LIMIT) {
      throw new ApiErrorException(429, 'unlock-too-many-attempts');
    }
  }

  recordWrong(userId: number, keyId: number): void {
    this.forgetExpired();
    const key = keyOf(userId, keyId);
    const times = this.#wrong.get(key) ?? [];
    times.push(Date.now());
    this.#wrong.set(key, times);
  }

  /** After a correct passphrase. */
  clear(userId: number, keyId: number): void {
    this.#wrong.delete(keyOf(userId, keyId));
  }

  /** How many keys have wrong attempts within the window; for tests. */
  get size(): number {
    this.forgetExpired();
    return this.#wrong.size;
  }

  /** Drops attempts older than the window, and keys left without any, so that the map stays small. */
  private forgetExpired(): void {
    const since = Date.now() - UNLOCK_ATTEMPT_WINDOW_MS;
    for (const [ key, times ] of this.#wrong) {
      const kept = times.filter(time => time > since);
      if (kept.length === 0) {
        this.#wrong.delete(key);
      } else if (kept.length !== times.length) {
        this.#wrong.set(key, kept);
      }
    }
  }
}

const keyOf = (userId: number, keyId: number): string => `${userId}:${keyId}`;
