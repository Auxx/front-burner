import type { UnlockedKey } from '@front-burner/server-core-git';
import { Injectable } from '@nestjs/common';

/**
 * Decrypted passphrase-protected keys held for queued jobs, such as a clone or
 * a push, in memory only (A-6.3, AR-49, RC-19): a job finishes even if the
 * session that unlocked the key ends meanwhile, and does not extend the unlock.
 * Lost on restart, where an interrupted job fails anyway. Every end of a job
 * releases its key.
 */
@Injectable()
export class JobKeys {
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
