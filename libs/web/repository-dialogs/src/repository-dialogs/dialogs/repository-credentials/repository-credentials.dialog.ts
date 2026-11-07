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
import { apply, disabled, form, FormField, submit, validateStandardSchema } from '@angular/forms/signals';
import {
  NewHttpsCredentialsSchema,
  type RepositoryCredentialsInfo,
  type RepositorySummary,
  type SavedCredentials
} from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  type ChoiceOption,
  DIALOG_DATA,
  DialogComponent,
  DialogFooterComponent,
  DialogRef,
  FieldComponent,
  IconButtonComponent,
  IconComponent,
  InlineBannerComponent,
  InputComponent,
  KeyValueComponent,
  KeyValueListComponent,
  PasswordRevealDirective,
  SegmentedControlComponent,
  SpinnerComponent
} from '@front-burner/ui';
import { CredentialsApi, RepositoriesApi } from '@front-burner/web-api-client';
import { type ApiErrorText, ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { CredentialsSectionComponent } from '../../credentials-form/components/credentials-section/credentials-section.component';
import {
  credentialsFailureKey,
  credentialsShownError,
  type FailureText,
  type FieldErrorText,
  isCredentialsPath
} from '../../credentials-form/credentials-errors';
import {
  credentialsSchema,
  defaultCredentials,
  toRepositoryCredentials
} from '../../credentials-form/credentials-form.model';
import { SessionKeysService } from '../../credentials-form/services/session-keys/session-keys.service';
import { SubmitFailuresService } from '../../credentials-form/services/submit-failures/submit-failures.service';
import { HostNotTrusted, HostTrustService } from '../../services/host-trust/host-trust.service';

/** What `RepositoryCredentialsDialog` is opened with. */
export interface RepositoryCredentialsDialogData {
  readonly repository: RepositorySummary;
  /** `refused-key`: the remote refused the repository's key, so the dialog says what to check (RC-14). */
  readonly hint?: 'refused-key';
  /**
   * The remote refused the repository's credentials: when they are saved
   * HTTPS credentials, the dialog offers to update their token, by default
   * (RC-12, RC-14).
   */
  readonly offerTokenUpdate?: boolean;
}

/** RC-12's choices: update the saved credentials' token, or give the repository others. */
type TokenChoice = 'update' | 'other';

/** The fields of **Update the token**. */
interface TokenModel {
  username: string;
  password: string;
}

const KEY = 'web-repository-dialogs.RepositoryCredentialsDialog';

const NO_CREDENTIALS: SavedCredentials = { https: [], sshKeys: [] };

let nextId = 0;

/**
 * Gives a repository other credentials (RC-7 to RC-10, RC-14): the repository's
 * name and remote (DS-18), the credentials in use, and the choices of the
 * Add repository page for the remote's protocol, which cannot change here.
 * When the remote refused saved HTTPS credentials, it first offers to update
 * their username and token instead, for every repository that uses them
 * (RC-12, RC-13); the two choices keep their own fields, so that only the
 * chosen one's are sent. **Save** or **Update** runs the backend's access
 * check; it closes with `true` once the repository uses the new credentials
 * or token, and with nothing when cancelled. A
 * failed check keeps it open with the error as on the Add repository page
 * (AR-42); an unknown SSH host asks to trust it, then checks again (AR-32).
 *
 * **Cancel** and Escape are unavailable while the check runs: the backend
 * may already use the new credentials when it answers, and the push must then
 * run again (RC-9). Everything typed, and the key generated or unlocked, belongs to
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
    SpinnerComponent,
    FormField,
    FieldComponent,
    InputComponent,
    IconButtonComponent,
    IconComponent,
    PasswordRevealDirective,
    SegmentedControlComponent
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
  private readonly hostTrust = inject(HostTrustService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly sessionKeys = inject(SessionKeysService);
  private readonly failures = inject(SubmitFailuresService);
  private readonly transloco = inject(TranslocoService);
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
  /** RC-12's choice; only shown while {@link updatable} has credentials. */
  protected readonly tokenChoice = signal<TokenChoice>('update');
  protected readonly tokenModel = form(signal<TokenModel>({ username: '', password: '' }), path => {
    validateStandardSchema(path.username, NewHttpsCredentialsSchema.shape.username);
    validateStandardSchema(path.password, NewHttpsCredentialsSchema.shape.password);
    disabled(path, () => this.submitting());
  });
  /** A failure that concerns no field the dialog shows, above the buttons (AR-6). */
  protected readonly failure = signal<ApiErrorText | null>(null);

  protected readonly protocol = computed(() => this.info()?.protocol);
  /** RC-14's hint, for a key only. */
  protected readonly refusedKey = computed(() => this.data.hint === 'refused-key' && this.protocol() === 'ssh');
  /** The saved HTTPS credentials whose token the dialog offers to update (RC-12, RC-14), if any. */
  protected readonly updatable = computed(() => {
    const inUse = this.info()?.inUse;
    return this.data.offerTokenUpdate === true && this.protocol() === 'https' && inUse?.kind === 'https'
      ? inUse
      : null;
  });
  /** Whether **Update the token** is chosen. */
  protected readonly updating = computed(() => this.updatable() !== null && this.tokenChoice() === 'update');
  protected readonly tokenChoices = computed<readonly ChoiceOption<TokenChoice>[]>(() => {
    // Re-evaluated when the language changes.
    this.transloco.activeLang();
    const name = this.updatable()?.name ?? '';
    return [
      { value: 'update', label: this.transloco.translate(`${KEY}.choices.update`, { name }) },
      { value: 'other', label: this.transloco.translate(`${KEY}.choices.other`) }
    ];
  });

  /** The failure or error to show on each field of **Update the token**. */
  protected readonly tokenErrors = computed(() => ({
    username: this.tokenError('username'),
    password: this.tokenError('password')
  }));

  /** A failure of the credentials as a whole on **Update the token**, such as refused credentials. */
  protected readonly tokenFailure = computed(() => this.failures.forPath('credentials'));

  /** **Save** or **Update** is available once the chosen fields are valid and no request of the form runs (AR-7). */
  protected readonly ready = computed(() => {
    if (this.info() === null || this.submitting()) {
      return false;
    }
    return this.updating() ? this.tokenModel().valid() : this.model().valid() && !this.sessionKeys.busy();
  });

  constructor() {
    // A failure stays on its field until the inputs change; passphrases are cleared after it (AR-46).
    this.failures.watch(computed(() =>
      JSON.stringify({
        ...this.model().value(),
        passphrase: '',
        generated: this.sessionKeys.generated()?.key.id,
        token: this.updating() ? this.tokenModel().value() : null
      })
    ));
    void this.load();
    // The first field once the choices are shown; until then `ui-dialog` has focused the dialog (RC-25).
    const focusFirstField = effect(() => {
      // **Update the token** does not use the saved credentials, so it does not wait for them.
      if (this.info() === null || (this.saved() === null && !this.updating())) {
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
    if (this.updating()) {
      return this.updateToken();
    }
    await submit(this.model, async () => {
      const credentials = toRepositoryCredentials(this.model().value(), this.sessionKeys.generated());
      if (!this.ready() || credentials === undefined) {
        return undefined;
      }
      this.submitting.set(true);
      this.ref.dismissible.set(false);
      this.failure.set(null);
      this.failures.clear();
      try {
        await this.hostTrust.trusting(() =>
          firstValueFrom(this.repositoriesApi.replaceRepositoryCredentials(this.data.repository.id, credentials))
        );
      } catch (error) {
        if (!(error instanceof HostNotTrusted)) {
          // AR-46: everything else stays.
          this.model.passphrase().value.set('');
          this.refusal(error);
        }
        return undefined;
      } finally {
        this.submitting.set(false);
        this.ref.dismissible.set(true);
      }
      this.ref.close(true);
      return undefined;
    });
  }

  /**
   * Updates the token of the saved credentials in use (RC-13), as typed:
   * neither is trimmed, as when they were saved (AR-20). A failure keeps the
   * dialog open with everything typed (AR-42). When the repository's
   * credentials can no longer be updated, because they were replaced
   * meanwhile, it shows the other choices with the credentials now in use.
   */
  private async updateToken(): Promise<void> {
    await submit(this.tokenModel, async () => {
      if (!this.ready()) {
        return undefined;
      }
      const { username, password } = this.tokenModel().value();
      this.submitting.set(true);
      this.ref.dismissible.set(false);
      this.failure.set(null);
      this.failures.clear();
      try {
        await firstValueFrom(
          this.repositoriesApi.updateRepositoryToken(this.data.repository.id, { username, password })
        );
      } catch (error) {
        // The request's own fields are named as the credentials' here; others, such as `remoteUrl`, stay.
        this.refusal(error, path => path === 'username' || path === 'password' ? `credentials.${path}` : path);
        if (toApiError(error).code === 'credentials-not-updatable') {
          this.tokenChoice.set('other');
          void this.loadInfo();
        }
        return undefined;
      } finally {
        this.submitting.set(false);
        this.ref.dismissible.set(true);
      }
      this.ref.close(true);
      return undefined;
    });
  }

  /** The failure or error of a field of **Update the token**, under `web-repository-dialogs.errors`. */
  private tokenError(name: keyof TokenModel): FieldErrorText | undefined {
    return this.failures.forPath(`credentials.${name}`)
      ?? credentialsShownError(this.tokenModel[name], `credentials.${name}`);
  }

  /**
   * Puts each failure of the credentials on its field, and any other above
   * the buttons, with the API's text of its code (AR-6, AR-42), such as a
   * remote that can't be reached.
   */
  private refusal(error: unknown, pathOf: (path: string) => string = path => path): void {
    const apiError = toApiError(error);
    const fields = (apiError.fields ?? []).map(field => ({ ...field, path: pathOf(field.path) }));
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
    if (this.updating()) {
      return [ 'credentials', 'credentials.username', 'credentials.password' ].includes(path);
    }
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
    await this.loadInfo();
  }

  private async loadInfo(): Promise<void> {
    try {
      const info = await firstValueFrom(this.repositoriesApi.repositoryCredentials(this.data.repository.id));
      if (info.inUse?.kind === 'https') {
        // Prefilled, and can be changed (RC-12).
        this.tokenModel.username().value.set(info.inUse.username);
      }
      this.info.set(info);
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
