import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal
} from '@angular/core';
import { apply, disabled, form, submit } from '@angular/forms/signals';
import type {
  HostKey,
  RepositoryCredentials,
  RepositoryCredentialsInfo,
  RepositorySummary,
  SavedCredentials
} from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  DIALOG_DATA,
  DialogComponent,
  DialogFooterComponent,
  DialogRef,
  DialogService,
  InlineBannerComponent,
  KeyValueComponent,
  KeyValueListComponent,
  SpinnerComponent
} from '@front-burner/ui';
import { CredentialsApi, KnownHostsApi, RepositoriesApi } from '@front-burner/web-api-client';
import { type ApiErrorText, ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { CredentialsSectionComponent } from '../../credentials-form/components/credentials-section/credentials-section.component';
import { credentialsFailureKey, type FailureText, isCredentialsPath } from '../../credentials-form/credentials-errors';
import {
  credentialsSchema,
  defaultCredentials,
  toRepositoryCredentials
} from '../../credentials-form/credentials-form.model';
import { TrustHostDialog } from '../../credentials-form/dialogs/trust-host/trust-host.dialog';
import { unknownHostKey } from '../../credentials-form/host-keys';
import { SessionKeysService } from '../../credentials-form/services/session-keys/session-keys.service';
import { SubmitFailuresService } from '../../credentials-form/services/submit-failures/submit-failures.service';

/** What `RepositoryCredentialsDialog` is opened with. */
export interface RepositoryCredentialsDialogData {
  readonly repository: RepositorySummary;
  /** `refused-key`: the remote refused the repository's key, so the dialog says what to check (RC-14). */
  readonly hint?: 'refused-key';
}

const NO_CREDENTIALS: SavedCredentials = { https: [], sshKeys: [] };

let nextId = 0;

/** The user cancelled the host key dialog: the form stays as it was (AR-32). */
class HostNotTrusted extends Error {}

/** The user closed the dialog while its request ran: its answer is ignored. */
class Closed extends Error {}

/**
 * Gives a repository other credentials (RC-7 to RC-10, RC-14): the repository's
 * name and remote (DS-18), the credentials in use, and the choices of the
 * Add repository page for the remote's protocol, which cannot change here.
 * **Save** runs the backend's access check; it closes with `true` once the
 * repository uses the new credentials, and with nothing when cancelled. A
 * failed check keeps it open with the error as on the Add repository page
 * (AR-42); an unknown SSH host asks to trust it, then checks again (AR-32).
 *
 * **Cancel** stays usable while the check runs, and its answer is then
 * ignored. Everything typed, and the key generated or unlocked, belongs to
 * this instance: a generated key is saved in the user's profile already, so
 * it is among the saved keys the next time (AR-30).
 */
@Component({
  selector: 'dlg-repository-credentials',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    CredentialsSectionComponent,
    DialogComponent,
    DialogFooterComponent,
    InlineBannerComponent,
    KeyValueComponent,
    KeyValueListComponent,
    SpinnerComponent
  ],
  templateUrl: './repository-credentials.dialog.html',
  styleUrl: './repository-credentials.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ SessionKeysService, SubmitFailuresService ]
})
export class RepositoryCredentialsDialog {
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as RepositoryCredentialsDialogData;
  private readonly repositoriesApi = inject(RepositoriesApi);
  private readonly credentialsApi = inject(CredentialsApi);
  private readonly knownHostsApi = inject(KnownHostsApi);
  private readonly dialogs = inject(DialogService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly sessionKeys = inject(SessionKeysService);
  private readonly failures = inject(SubmitFailuresService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  protected readonly formId = `dlg-repository-credentials-${nextId++}`;
  /** The repository's protocol and credentials in use; `null` while they load. */
  protected readonly info = signal<RepositoryCredentialsInfo | null>(null);
  /** The user's saved credentials as loaded; `null` while they load. */
  private readonly loaded = signal<SavedCredentials | null>(null);
  /** With this dialog's generated key and unlocks (AR-25, AR-30). */
  protected readonly saved = computed(() => {
    const loaded = this.loaded();
    return loaded === null ? null : this.sessionKeys.withSessionKeys(loaded);
  });
  protected readonly submitting = signal(false);
  protected readonly model = form(signal(defaultCredentials(undefined, NO_CREDENTIALS)), path => {
    apply(
      path,
      credentialsSchema({
        saved: computed(() => this.saved() ?? NO_CREDENTIALS),
        generated: this.sessionKeys.generated
      })
    );
    disabled(path, () => this.submitting());
  });
  /** A failure that concerns no field the dialog shows, above the buttons (AR-6). */
  protected readonly failure = signal<ApiErrorText | null>(null);

  protected readonly protocol = computed(() => this.info()?.protocol);
  /** RC-14's hint, for a key only. */
  protected readonly refusedKey = computed(() => this.data.hint === 'refused-key' && this.protocol() === 'ssh');

  /** **Save** is available once the form is valid and no request of the form runs (AR-7). */
  protected readonly ready = computed(() =>
    this.info() !== null && !this.submitting() && this.model().valid() && !this.sessionKeys.busy()
  );

  /** Whether the dialog is still open, so that an answer that comes after Cancel is ignored. */
  private open = true;

  constructor() {
    this.ref.closed.subscribe(() => this.open = false);
    // A failure stays on its field until the inputs change; passphrases are cleared after it (AR-46).
    this.failures.watch(computed(() =>
      JSON.stringify({
        ...this.model().value(),
        passphrase: '',
        generated: this.sessionKeys.generated()?.key.id
      })
    ));
    void this.load();
    // The first field once the choices are shown; until then `ui-dialog` has focused the dialog (RC-25).
    const focusFirstField = effect(() => {
      if (this.info() === null || this.saved() === null) {
        return;
      }
      focusFirstField.destroy();
      afterNextRender(() => {
        const active = this.host.ownerDocument.activeElement;
        if (active === null || active === this.host.ownerDocument.body || active.getAttribute('role') === 'dialog') {
          this.host.querySelector<HTMLElement>('.choices :is(input, textarea, [role="combobox"]):not(:disabled)')
            ?.focus();
        }
      }, { injector: this.injector });
    });
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting()) {
      return;
    }
    await submit(this.model, async () => {
      const credentials = toRepositoryCredentials(this.model().value(), this.sessionKeys.generated());
      if (!this.ready() || credentials === undefined) {
        return undefined;
      }
      this.submitting.set(true);
      this.failure.set(null);
      this.failures.clear();
      try {
        await this.trusting(() => this.replace(credentials));
      } catch (error) {
        if (!(error instanceof HostNotTrusted || error instanceof Closed)) {
          // AR-46: everything else stays.
          this.model.passphrase().value.set('');
          this.refusal(error);
        }
        return undefined;
      } finally {
        this.submitting.set(false);
      }
      this.ref.close(true);
      return undefined;
    });
  }

  private async replace(credentials: RepositoryCredentials): Promise<void> {
    await firstValueFrom(this.repositoriesApi.replaceRepositoryCredentials(this.data.repository.id, credentials));
    if (!this.open) {
      throw new Closed();
    }
  }

  /**
   * Runs `request`; if it meets an unknown SSH host, asks the user to trust it
   * and runs it once more (AR-32). Throws {@link HostNotTrusted} on Cancel.
   */
  private async trusting(request: () => Promise<void>): Promise<void> {
    try {
      await request();
    } catch (error) {
      const hostKey = unknownHostKey(toApiError(error));
      if (hostKey === undefined || !this.open) {
        throw error;
      }
      await this.trust(hostKey);
      await request();
    }
  }

  private async trust(hostKey: HostKey): Promise<void> {
    const ref = this.dialogs.open<TrustHostDialog, HostKey, boolean>(TrustHostDialog, { data: hostKey, size: 'small' });
    if ((await firstValueFrom(ref.closed)) !== true) {
      throw new HostNotTrusted();
    }
    const { host, port, type, key } = hostKey;
    await firstValueFrom(this.knownHostsApi.trust({ host, port, type, key }), { defaultValue: undefined });
  }

  /**
   * Puts each failure of the credentials on its field, and any other above
   * the buttons, with the API's text of its code (AR-6, AR-42), such as a
   * remote that can't be reached.
   */
  private refusal(error: unknown): void {
    if (!this.open) {
      return;
    }
    const apiError = toApiError(error);
    const fields = apiError.fields ?? [];
    const credentials = this.model().value();
    if (
      credentials.choice === 'saved'
      && fields.some(field => field.path === 'credentials.passphrase' && field.code === 'passphrase-required')
    ) {
      // The key's unlock ended since the dialog opened (AR-31): ask for the passphrase again.
      this.sessionKeys.markLocked(credentials.savedId);
    }
    const shown: FailureText[] = fields
      .filter(field => isCredentialsPath(field.path) && this.shows(field.path))
      .map(({ path, code, params }) => ({ path, key: credentialsFailureKey(path, code, params), params }));
    this.failures.record(shown);
    const elsewhere = fields.find(field => !isCredentialsPath(field.path) || !this.shows(field.path));
    if (fields.length === 0) {
      this.failure.set(this.errorText.describe(apiError));
    } else if (elsewhere !== undefined) {
      this.failure.set(this.errorText.describe({ ...apiError, code: elsewhere.code, params: elsewhere.params }));
    }
  }

  /** Whether the dialog shows the credentials field the API's `path` names. */
  private shows(path: string): boolean {
    const { choice, savedId } = this.model().value();
    const key = this.saved()?.sshKeys.find(sshKey => sshKey.id === savedId);
    const shown: Record<string, boolean> = {
      credentials: true,
      'credentials.savedId': choice === 'saved',
      'credentials.name': choice === 'new-https' || choice === 'new-ssh-key',
      'credentials.username': choice === 'new-https',
      'credentials.password': choice === 'new-https',
      'credentials.privateKey': choice === 'new-ssh-key',
      'credentials.passphrase': choice === 'new-ssh-key'
        || (choice === 'saved' && key !== undefined && key.passphraseProtected && !key.unlocked),
      'credentials.generateName': choice === 'generate' && this.sessionKeys.generated() === null
    };
    return shown[path] ?? false;
  }

  private async load(): Promise<void> {
    void this.loadSaved();
    try {
      this.info.set(await firstValueFrom(this.repositoriesApi.repositoryCredentials(this.data.repository.id)));
    } catch (error) {
      this.failure.set(this.errorText.describe(toApiError(error)));
    }
  }

  /** Without them, the user can still add new credentials. */
  private async loadSaved(): Promise<void> {
    try {
      this.loaded.set(await firstValueFrom(this.credentialsApi.list()));
    } catch {
      this.loaded.set(NO_CREDENTIALS);
    }
  }
}
