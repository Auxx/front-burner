import { CONFIG, Config } from '@front-burner/server-core-config';
import { UnlockedKey, unlockPrivateKey } from '@front-burner/server-core-git';
import { SessionLifecycle } from '@front-burner/server-core-security';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subscription } from 'rxjs';

interface Unlock {
  key: UnlockedKey;
  timer: NodeJS.Timeout;
}

/**
 * Passphrase-protected keys unlocked per session, in memory only (AR-31,
 * A-5.5). An unlock ends when its session is revoked, when no git operation of
 * that session used it for the idle time, or when the backend stops.
 */
@Injectable()
export class KeyUnlockStore implements OnModuleDestroy {
  /** Session ID → credential ID → unlock. */
  readonly #sessions = new Map<string, Map<number, Unlock>>();
  readonly #subscription: Subscription;

  constructor(@Inject(CONFIG) private readonly config: Config, lifecycle: SessionLifecycle) {
    this.#subscription = lifecycle.revoked.subscribe(sessionId => this.dropSession(sessionId));
  }

  /**
   * Unlocks a key for one session; the passphrase is not kept.
   *
   * @throws SshKeyError such as `wrong-passphrase`.
   */
  unlock(sessionId: string, credentialId: number, privateKeyText: string, passphrase: string): void {
    const key = unlockPrivateKey(privateKeyText, passphrase);
    this.lock(sessionId, credentialId);
    let unlocks = this.#sessions.get(sessionId);
    if (unlocks === undefined) {
      unlocks = new Map();
      this.#sessions.set(sessionId, unlocks);
    }
    unlocks.set(credentialId, { key, timer: this.idleTimer(sessionId, credentialId) });
  }

  /**
   * The session's unlocked key. `touch: true` only for git operations started by
   * the user, which restart the idle timer; anything else must not keep the key
   * unlocked (AR-31, A-5.5).
   */
  get(sessionId: string, credentialId: number, options: { touch: boolean; }): UnlockedKey | undefined {
    const unlock = this.#sessions.get(sessionId)?.get(credentialId);
    if (unlock !== undefined && options.touch) {
      clearTimeout(unlock.timer);
      unlock.timer = this.idleTimer(sessionId, credentialId);
    }
    return unlock?.key;
  }

  isUnlocked(sessionId: string, credentialId: number): boolean {
    return this.#sessions.get(sessionId)?.has(credentialId) ?? false;
  }

  lock(sessionId: string, credentialId: number): void {
    const unlocks = this.#sessions.get(sessionId);
    const unlock = unlocks?.get(credentialId);
    if (unlocks === undefined || unlock === undefined) {
      return;
    }
    clearTimeout(unlock.timer);
    unlocks.delete(credentialId);
    if (unlocks.size === 0) {
      this.#sessions.delete(sessionId);
    }
  }

  /** Drops a credential's unlocks in every session, for example when it is deleted. */
  forgetCredential(credentialId: number): void {
    for (const sessionId of [ ...this.#sessions.keys() ]) {
      this.lock(sessionId, credentialId);
    }
  }

  onModuleDestroy(): void {
    this.#subscription.unsubscribe();
    for (const sessionId of [ ...this.#sessions.keys() ]) {
      this.dropSession(sessionId);
    }
  }

  private dropSession(sessionId: string): void {
    for (const credentialId of [ ...(this.#sessions.get(sessionId)?.keys() ?? []) ]) {
      this.lock(sessionId, credentialId);
    }
  }

  private idleTimer(sessionId: string, credentialId: number): NodeJS.Timeout {
    return setTimeout(() => this.lock(sessionId, credentialId), this.config.keyUnlockIdleMs).unref();
  }
}
