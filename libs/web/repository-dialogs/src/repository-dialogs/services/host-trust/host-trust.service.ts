import { inject, Injectable } from '@angular/core';
import type { HostKey } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { KnownHostsApi } from '@front-burner/web-api-client';
import { toApiError } from '@front-burner/web-core';
import { firstValueFrom } from 'rxjs';

import { TrustHostDialog } from '../../credentials-form/dialogs/trust-host/trust-host.dialog';
import { unknownHostKey } from '../../credentials-form/host-keys';

/** The user cancelled the host key dialog: what the request was for stays as it was (AR-32). */
export class HostNotTrusted extends Error {}

/**
 * Trusting an unknown SSH server (AR-32), for the forms with the credentials
 * section: asks the user with `TrustHostDialog`, and saves the host key once
 * they trust it.
 */
@Injectable({ providedIn: 'root' })
export class HostTrustService {
  private readonly dialogs = inject(DialogService);
  private readonly knownHostsApi = inject(KnownHostsApi);

  /**
   * Runs `request`; if it meets an unknown SSH host, asks the user to trust it
   * and runs it once more. Throws {@link HostNotTrusted} on Cancel.
   */
  async trusting<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      const hostKey = unknownHostKey(toApiError(error));
      if (hostKey === undefined) {
        throw error;
      }
      await this.trust(hostKey);
      return request();
    }
  }

  /** Asks the user to trust `hostKey`, and saves it. Throws {@link HostNotTrusted} on Cancel. */
  async trust(hostKey: HostKey): Promise<void> {
    const ref = this.dialogs.open<TrustHostDialog, HostKey, boolean>(TrustHostDialog, { data: hostKey, size: 'small' });
    if ((await firstValueFrom(ref.closed)) !== true) {
      throw new HostNotTrusted();
    }
    const { host, port, type, key } = hostKey;
    await firstValueFrom(this.knownHostsApi.trust({ host, port, type, key }), { defaultValue: undefined });
  }
}
