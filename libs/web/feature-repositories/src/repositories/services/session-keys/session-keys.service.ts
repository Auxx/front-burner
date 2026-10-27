import { computed, inject, Injectable, signal } from '@angular/core';
import type { GeneratedSshKey, SavedCredentials } from '@front-burner/shared-contracts';
import { CredentialsApi } from '@front-burner/web-api-client';
import { firstValueFrom } from 'rxjs';

/**
 * The SSH keys generated or unlocked during one visit to the Add repository
 * page, which the saved credentials loaded with the page do not know about
 * (AR-25, AR-29 to AR-31). Provided by the page.
 */
@Injectable()
export class SessionKeysService {
  private readonly api = inject(CredentialsApi);
  private readonly unlockedIds = signal<ReadonlySet<number>>(new Set());
  private readonly requests = signal(0);

  /** The key generated on this visit; at most one (AR-30). */
  readonly generated = signal<GeneratedSshKey | null>(null);
  /** A request to generate or unlock a key is running (AR-7). */
  readonly busy = computed(() => this.requests() > 0);

  /** `saved` with the generated key added and this visit's unlocks marked. */
  withSessionKeys(saved: SavedCredentials): SavedCredentials {
    const generated = this.generated()?.key;
    const unlocked = this.unlockedIds();
    const sshKeys = generated && !saved.sshKeys.some(key => key.id === generated.id)
      ? [ ...saved.sshKeys, generated ]
      : saved.sshKeys;
    return {
      https: saved.https,
      sshKeys: sshKeys.map(key => unlocked.has(key.id) ? { ...key, unlocked: true } : key)
    };
  }

  /** Generates and saves a key (AR-29); a second call on the same visit fails. */
  async generate(name: string): Promise<GeneratedSshKey> {
    if (this.generated() !== null) {
      throw new Error('A key was generated on this visit already');
    }
    const generated = await this.track(firstValueFrom(this.api.generateSshKey({ name })));
    this.generated.set(generated);
    return generated;
  }

  /** Unlocks a saved key for the session; fails with the API's error, such as a wrong passphrase. */
  async unlock(id: number, passphrase: string): Promise<void> {
    await this.track(firstValueFrom(this.api.unlockSshKey(id, { passphrase }), { defaultValue: undefined }));
    this.unlockedIds.update(ids => new Set([ ...ids, id ]));
  }

  private async track<T>(request: Promise<T>): Promise<T> {
    this.requests.update(count => count + 1);
    try {
      return await request;
    } finally {
      this.requests.update(count => count - 1);
    }
  }
}
