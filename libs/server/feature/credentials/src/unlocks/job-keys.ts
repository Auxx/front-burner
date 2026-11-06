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
  readonly #keys = new Map<number, { credentialId: number; key: UnlockedKey; }>();

  /** Holds the decrypted key of saved credential `credentialId` for the job. */
  hold(jobId: number, credentialId: number, key: UnlockedKey): void {
    this.#keys.set(jobId, { credentialId, key });
  }

  /**
   * The key held for the job, only when it is of the credential the job uses
   * now: credentials replaced since it was queued are not served the old key.
   */
  take(jobId: number, credentialId: number): UnlockedKey | undefined {
    const held = this.#keys.get(jobId);
    return held?.credentialId === credentialId ? held.key : undefined;
  }

  release(jobId: number): void {
    this.#keys.delete(jobId);
  }
}
