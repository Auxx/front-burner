import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
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

const SSH_PORT = 22;

/**
 * "Do you trust this server?" (AR-32): the host, key type and fingerprint of
 * an SSH server the user has not accepted yet. Closes with `true` for
 * **Trust** and `false` for **Cancel**, the safe choice, which has the focus.
 */
@Component({
  selector: 'repo-trust-host',
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

  protected readonly host = computed(() =>
    this.hostKey.port === SSH_PORT ? this.hostKey.host : `${this.hostKey.host}:${this.hostKey.port}`
  );
}
