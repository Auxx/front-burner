import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { RepositoryCredentialsInfo } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { PushChannelService } from '@front-burner/web-core';
import { UnlockKeyDialog, type UnlockKeyDialogData } from '@front-burner/web-repository-dialogs';
import { firstValueFrom } from 'rxjs';

import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

/** The open repository's SSH key, while it is locked in this session (RC-15). */
export type LockedKey = UnlockKeyDialogData;

/** The key of `info` if it is passphrase-protected, locked and can be unlocked. */
function lockedKeyOf(info: RepositoryCredentialsInfo): LockedKey | null {
  const key = info.inUse;
  if (key?.kind !== 'ssh-key' || !key.passphraseProtected || key.unlocked || key.missing) {
    return null;
  }
  return { id: key.id, name: key.name, keyType: key.keyType, fingerprint: key.fingerprint };
}

/**
 * Whether the open repository's key is locked in this session, for the
 * locked-key banner (RC-15), and unlocking it (RC-16). Provided by the page.
 *
 * It reads the repository's credentials when the repository is ready and after
 * every (re)connect, since events are never replayed (A-3.11): a backend
 * restart forgets every unlock. `key.unlocked` comes only from this session
 * (RC-20), and removes the banner at once. A key whose secret is `missing`
 * (NF-8.6) is never offered: unlocking it can only fail.
 *
 * The banner can be dismissed for the rest of the visit: until another
 * repository is opened, or the page is left.
 */
@Injectable()
export class LockedKeyService {
  private readonly api = inject(RepositoriesApi);
  private readonly dialogs = inject(DialogService);
  private readonly push = inject(PushChannelService);
  private readonly session = inject(RepositorySessionService);
  private readonly store = inject(GitStatusStore);

  private readonly current = signal<LockedKey | null>(null);
  /** The latest read: only that one may change what is shown. */
  private latestRead = 0;
  /** For each read in flight, the keys unlocked since it was sent, which its answer may still call locked. */
  private readonly unlockedDuringReads = new Set<Set<number>>();
  /** The dialog open now, so that a second request waits for it rather than opening another. */
  private asking: Promise<boolean> | null = null;

  /** The open repository's key while it is locked; `null` otherwise, or until read. */
  readonly key = this.current.asReadonly();
  /** Whether the user dismissed the banner on this visit (RC-15). */
  readonly dismissed = signal(false);

  private readonly repositoryId = computed(() => {
    const id = this.store.followed();
    return this.session.state() === 'ready' && this.session.repository()?.id === id ? id : null;
  });

  constructor() {
    /** The last repository read, so that a dismissal lasts while the session reopens the same one. */
    let lastId: number | null = null;
    effect(() => {
      const id = this.repositoryId();
      untracked(() => {
        this.latestRead++;
        this.current.set(null);
        if (id !== null && id !== lastId) {
          lastId = id;
          this.dismissed.set(false);
        }
        if (id !== null) {
          void this.read(id);
        }
      });
    });
    // `reconnected` first, as in `TreeSyncService`.
    this.push.reconnected.pipe(takeUntilDestroyed()).subscribe(() => {
      const id = this.repositoryId();
      if (id !== null) {
        void this.read(id);
      }
    });
    this.push.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event.type !== 'key.unlocked') {
        return;
      }
      this.unlockedDuringReads.forEach(keys => keys.add(event.keyId));
      if (event.keyId === this.current()?.id) {
        this.current.set(null);
      }
    });
  }

  /**
   * Asks for the passphrase of the open repository's key, and resolves whether
   * it was unlocked; `false` when cancelled. The key is read again first when
   * the banner does not know it, such as when the unlock ended by itself after
   * the banner went away. Resolves `true` without asking if it turns out to be
   * unlocked already, and rejects when it cannot be read, as nothing could be
   * asked.
   */
  unlock(): Promise<boolean> {
    this.asking ??= this.ask().finally(() => this.asking = null);
    return this.asking;
  }

  /**
   * Reads the key again, such as after the repository was given other
   * credentials (RC-8), which may be a locked key. A read that fails changes
   * nothing.
   */
  async reread(): Promise<void> {
    const id = this.repositoryId();
    if (id !== null) {
      await this.read(id);
    }
  }

  private async ask(): Promise<boolean> {
    const id = this.repositoryId();
    if (id === null) {
      return false;
    }
    const key = this.current() ?? await this.readKey(id);
    if (key === null) {
      return true;
    }
    const ref = this.dialogs.open<UnlockKeyDialog, UnlockKeyDialogData, boolean>(UnlockKeyDialog, { data: key });
    const unlocked = await firstValueFrom(ref.closed, { defaultValue: undefined }) === true;
    if (unlocked && this.current()?.id === key.id) {
      this.current.set(null);
    }
    return unlocked;
  }

  /** Reads whether the key is locked; a read that fails changes nothing. */
  private async read(id: number): Promise<void> {
    try {
      await this.readKey(id);
    } catch {
      // The banner keeps what it showed; the next (re)connect reads again.
    }
  }

  /**
   * Reads the key while it is locked, and rejects when the read fails. A key
   * that `key.unlocked` named while the read was on its way counts as unlocked,
   * and a newer read, or a switch, has the last word on what is shown.
   */
  private async readKey(id: number): Promise<LockedKey | null> {
    const read = ++this.latestRead;
    const unlockedMeanwhile = new Set<number>();
    this.unlockedDuringReads.add(unlockedMeanwhile);
    let key: LockedKey | null;
    try {
      key = lockedKeyOf(await firstValueFrom(this.api.repositoryCredentials(id)));
    } finally {
      this.unlockedDuringReads.delete(unlockedMeanwhile);
    }
    if (key !== null && unlockedMeanwhile.has(key.id)) {
      key = null;
    }
    if (read === this.latestRead) {
      this.current.set(key);
    }
    return key;
  }
}
