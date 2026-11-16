import { inject, Injectable } from '@angular/core';
import {
  type ChangedHostKey,
  ChangedHostKeySchema,
  type RepositoryCredentialsInfo
} from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { firstValueFrom } from 'rxjs';

import { ChangedHostKeyDialog } from '../../dialogs/changed-host-key/changed-host-key.dialog';
import { UnlockKeyDialog, type UnlockKeyDialogData } from '../../dialogs/unlock-key/unlock-key.dialog';

/** A repository's passphrase-protected SSH key: what the unlock dialog shows, and whether this session unlocked it. */
export interface ProtectedKey {
  readonly key: UnlockKeyDialogData;
  readonly unlocked: boolean;
}

/**
 * The SSH key in use of `info` when unlocking it can help: it is
 * passphrase-protected and its secret is there, since a key whose secret an
 * encryption key reset deleted can only fail (NF-8.6). `null` otherwise.
 */
export function protectedKeyOf(info: RepositoryCredentialsInfo): ProtectedKey | null {
  const inUse = info.inUse;
  if (inUse?.kind !== 'ssh-key' || !inUse.passphraseProtected || inUse.missing) {
    return null;
  }
  return {
    key: { id: inUse.id, name: inUse.name, keyType: inUse.keyType, fingerprint: inUse.fingerprint },
    unlocked: inUse.unlocked
  };
}

/**
 * The key dialogs that every place offering a credential fix opens the same
 * way: **Unlock** (RC-16) and **Review the new key** (RC-21). Each resolves
 * whether the fix was made; what runs after it is the caller's.
 */
@Injectable({ providedIn: 'root' })
export class KeyDialogsService {
  private readonly dialogs = inject(DialogService);

  /** Asks for the passphrase of `key`: `true` once it is unlocked, `false` when cancelled. */
  async unlock(key: UnlockKeyDialogData): Promise<boolean> {
    const ref = this.dialogs.open<UnlockKeyDialog, UnlockKeyDialogData, boolean>(UnlockKeyDialog, { data: key });
    return await firstValueFrom(ref.closed, { defaultValue: undefined }) === true;
  }

  /**
   * Shows the changed host key that `params` describe, the params of a
   * `host-key-changed` problem: `true` once the new key is trusted, or on **Try
   * again** when there was no new key to trust; `false` when cancelled; and
   * `null`, opening nothing, when `params` do not describe a changed key.
   */
  async reviewHostKey(params: unknown): Promise<boolean | null> {
    const parsed = ChangedHostKeySchema.safeParse(params);
    if (!parsed.success) {
      return null;
    }
    const ref = this.dialogs.open<ChangedHostKeyDialog, ChangedHostKey, boolean>(ChangedHostKeyDialog, {
      data: parsed.data
    });
    return await firstValueFrom(ref.closed, { defaultValue: undefined }) === true;
  }
}
