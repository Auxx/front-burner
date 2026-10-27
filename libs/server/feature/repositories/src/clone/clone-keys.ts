import type { UnlockedKey } from '@front-burner/server-core-git';
import { Injectable } from '@nestjs/common';

/**
 * Decrypted passphrase-protected keys held for queued clone jobs, in memory
 * only (A-6.3, AR-49): a clone finishes even if the session that unlocked the
 * key ends meanwhile. Lost on restart, where an interrupted clone fails anyway.
 */
@Injectable()
export class CloneKeys {
  readonly #keys = new Map<number, UnlockedKey>();

  hold(jobId: number, key: UnlockedKey): void {
    this.#keys.set(jobId, key);
  }

  take(jobId: number): UnlockedKey | undefined {
    return this.#keys.get(jobId);
  }

  release(jobId: number): void {
    this.#keys.delete(jobId);
  }
}
