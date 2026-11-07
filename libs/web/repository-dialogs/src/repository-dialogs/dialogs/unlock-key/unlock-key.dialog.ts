import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild
} from '@angular/core';
import type { SshKeyType } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  DIALOG_DATA,
  DialogComponent,
  DialogFooterComponent,
  DialogRef,
  FieldComponent,
  InlineBannerComponent,
  InputComponent,
  KeyValueComponent,
  KeyValueListComponent
} from '@front-burner/ui';
import { CredentialsApi } from '@front-burner/web-api-client';
import { type ApiErrorText, ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

/** The key that `UnlockKeyDialog` unlocks: its public parts (RC-16). */
export interface UnlockKeyDialogData {
  readonly id: number;
  readonly name: string;
  readonly keyType: SshKeyType;
  readonly fingerprint: string;
}

/** Why the passphrase was refused, as the key of its text under `UnlockKeyDialog.errors`. */
type PassphraseError = 'required' | 'wrong-passphrase' | 'unlock-too-many-attempts';

let nextId = 0;

/**
 * Unlocks a passphrase-protected SSH key for the session (RC-16, AR-31): the
 * key's name, type and fingerprint, and a masked, required **Passphrase**. It
 * closes with `true` once the key is unlocked, and with nothing when cancelled.
 *
 * "Wrong passphrase" and "Too many attempts" go on the field (RC-18); the
 * second is a `429` without `fields`, so the dialog puts it there itself. Any
 * other failure is shown above the buttons. Every attempt counts toward the
 * backend's limit, so a second submit while one runs sends nothing.
 *
 * The passphrase lives only in this dialog's own signal, which goes with it,
 * and is never stored in the browser (AR-17).
 */
@Component({
  selector: 'dlg-unlock-key',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    DialogComponent,
    DialogFooterComponent,
    FieldComponent,
    InlineBannerComponent,
    InputComponent,
    KeyValueComponent,
    KeyValueListComponent
  ],
  templateUrl: './unlock-key.dialog.html',
  styleUrl: './unlock-key.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UnlockKeyDialog {
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as UnlockKeyDialogData;
  private readonly api = inject(CredentialsApi);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly injector = inject(Injector);

  protected readonly formId = `dlg-unlock-key-${nextId++}`;
  protected readonly passphrase = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<PassphraseError | null>(null);
  protected readonly failure = signal<ApiErrorText | null>(null);

  private readonly input = viewChild.required('passphraseInput', { read: ElementRef<HTMLInputElement> });

  protected typed(event: Event): void {
    this.passphrase.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected async unlock(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) {
      return;
    }
    this.failure.set(null);
    const passphrase = this.passphrase();
    if (passphrase === '') {
      this.refuse('required');
      return;
    }
    this.busy.set(true);
    this.ref.dismissible.set(false);
    try {
      await firstValueFrom(this.api.unlockSshKey(this.data.id, { passphrase }), { defaultValue: undefined });
      this.passphrase.set('');
      this.ref.close(true);
    } catch (error) {
      const apiError = toApiError(error);
      const fieldCode = apiError.fields?.find(field => field.path === 'passphrase')?.code;
      if (fieldCode === 'wrong-passphrase') {
        this.refuse('wrong-passphrase');
      } else if (apiError.code === 'unlock-too-many-attempts') {
        this.refuse('unlock-too-many-attempts');
      } else {
        this.failure.set(this.errorText.describe(apiError));
      }
    } finally {
      this.busy.set(false);
      this.ref.dismissible.set(true);
    }
  }

  private refuse(error: PassphraseError): void {
    this.error.set(error);
    afterNextRender(() => this.input().nativeElement.focus(), { injector: this.injector });
  }
}
