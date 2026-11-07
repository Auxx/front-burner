import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { HostKey } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  DIALOG_DATA,
  DialogComponent,
  DialogFooterComponent,
  DialogRef,
  KeyValueComponent,
  KeyValueListComponent
} from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { hostLabel } from '../../host-keys';

/**
 * "Do you trust this server?" (AR-32): the host, key type and fingerprint of
 * an SSH server the user has not accepted yet. Closes with `true` for
 * **Trust** and `false` for **Cancel**, the safe choice, which has the focus.
 */
@Component({
  selector: 'dlg-trust-host',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    DialogComponent,
    DialogFooterComponent,
    KeyValueComponent,
    KeyValueListComponent
  ],
  templateUrl: './trust-host.dialog.html',
  styleUrl: './trust-host.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TrustHostDialog {
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  protected readonly hostKey = inject(DIALOG_DATA) as HostKey;

  protected readonly host = hostLabel(this.hostKey.host, this.hostKey.port);
}
