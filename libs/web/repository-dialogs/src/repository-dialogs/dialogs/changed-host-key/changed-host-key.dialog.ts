import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { type ChangedHostKey, type TrustHostRequest, TrustHostRequestSchema } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  CheckboxComponent,
  ChoiceComponent,
  DIALOG_DATA,
  DialogComponent,
  DialogFooterComponent,
  DialogRef,
  InlineBannerComponent,
  KeyValueComponent,
  KeyValueListComponent
} from '@front-burner/ui';
import { KnownHostsApi } from '@front-burner/web-api-client';
import { type ApiErrorText, ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { hostLabel } from '../../credentials-form/host-keys';

const GITHUB_FINGERPRINTS =
  'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints';
const BITBUCKET_FINGERPRINTS =
  'https://support.atlassian.com/bitbucket-cloud/docs/configure-ssh-and-two-step-verification/';

/**
 * The providers' published fingerprints, for exactly these hosts (RC-21): their
 * SSH hosts, and those of SSH over the HTTPS port, which have the same keys. A
 * `Map`, so that no inherited property of an object matches a host.
 */
const PUBLISHED_FINGERPRINTS: ReadonlyMap<string, string> = new Map([
  [ 'github.com', GITHUB_FINGERPRINTS ],
  [ 'ssh.github.com', GITHUB_FINGERPRINTS ],
  [ 'bitbucket.org', BITBUCKET_FINGERPRINTS ],
  [ 'altssh.bitbucket.org', BITBUCKET_FINGERPRINTS ]
]);

/** The new key as the backend stores it, and its fingerprint to show, when the backend could read it. */
interface NewKey {
  readonly request: TrustHostRequest;
  readonly fingerprint: string;
}

function newKeyOf({ host, port, type, key, fingerprint }: ChangedHostKey): NewKey | null {
  const parsed = TrustHostRequestSchema.safeParse({ host, port, type, key });
  return parsed.success && fingerprint !== undefined ? { request: parsed.data, fingerprint } : null;
}

/**
 * "The server's identity has changed. This may be an attack." (RC-21, RC-22):
 * the host and port, the key that was trusted and the new one, each as key type
 * and SHA256 fingerprint, and for GitHub's and Bitbucket's SSH hosts a link to
 * the provider's published fingerprints.
 *
 * **Trust the new key** is unavailable until the user ticks that they have
 * checked the new fingerprint; it then replaces the user's trusted key for that
 * host and port, and closes with `true`. When saving fails, the dialog stays
 * open with the error. **Cancel**, which has the focus and is what Enter
 * presses, closes with nothing and changes nothing. There is no form to submit.
 *
 * Without a new key (the backend could not reach the server to read it), there
 * is nothing to trust: the dialog says so, and **Try again** closes with `true`
 * so that the failed operation runs again.
 */
@Component({
  selector: 'dlg-changed-host-key',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    CheckboxComponent,
    ChoiceComponent,
    DialogComponent,
    DialogFooterComponent,
    InlineBannerComponent,
    KeyValueComponent,
    KeyValueListComponent
  ],
  templateUrl: './changed-host-key.dialog.html',
  styleUrl: './changed-host-key.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChangedHostKeyDialog {
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as ChangedHostKey;
  private readonly api = inject(KnownHostsApi);
  private readonly errorText = inject(ApiErrorTextService);

  protected readonly host = hostLabel(this.data.host, this.data.port);
  protected readonly publishedFingerprints = PUBLISHED_FINGERPRINTS.get(this.data.host.toLowerCase());
  protected readonly newKey = newKeyOf(this.data);

  protected readonly checked = signal(false);
  protected readonly busy = signal(false);
  protected readonly failure = signal<ApiErrorText | null>(null);
  protected readonly ready = computed(() => this.checked() && !this.busy());

  protected async trust(): Promise<void> {
    const newKey = this.newKey;
    if (newKey === null || !this.ready()) {
      return;
    }
    this.failure.set(null);
    this.busy.set(true);
    this.ref.dismissible.set(false);
    try {
      await firstValueFrom(this.api.replace(newKey.request), { defaultValue: undefined });
      this.ref.close(true);
    } catch (error) {
      this.failure.set(this.errorText.describe(toApiError(error)));
    } finally {
      this.busy.set(false);
      this.ref.dismissible.set(true);
    }
  }
}
