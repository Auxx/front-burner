import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import type { ApiError, RepositoryDetails } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  CollapsibleComponent,
  DialogService,
  IconComponent,
  InlineBannerComponent,
  ToastService
} from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { type ApiErrorText, ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { UnlockKeyDialog, type UnlockKeyDialogData } from '@front-burner/web-repository-dialogs';
import { RepositoryStatusDetailComponent } from '@front-burner/web-shell';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { RepositorySettingsStore } from '../../services/repository-settings-store/repository-settings-store.service';

const KEY = 'web-feature-repositories.CloneStatusComponent';

/** What the section offers in **Error**: **Retry clone** after a clone, **Clone again** for a damaged working copy. */
type CloneAction = 'retry' | 'clone-again';

/** How asking for a locked key's passphrase ended. */
type Unlock = 'unlocked' | 'cancelled' | 'impossible';

let nextId = 0;

/**
 * The **Status** section of the settings page (RM-9), only for a repository
 * that is **Cloning** or in **Error**. While cloning, the clone's progress or
 * "Waiting for other clones to finish", as the lists show it (RM-7, AR-52).
 * In error, the error's label and **Details**, closed by default, with git's
 * error as the backend recorded it, shown as plain text since it may contain
 * text from the remote, and the request ID with **Copy** (RM-10, NF-10.6).
 *
 * In error it also offers **Retry clone** after a failed, timed out or
 * interrupted clone (RM-11), and **Clone again** for a working copy that is
 * missing or damaged, once the user confirms that work only in the old
 * working copy is lost (RM-12). Both send `POST /repositories/:id/clone`, and
 * the answer shows **Cloning** at once through the page's store. A `409
 * key-locked` asks for the key's passphrase and sends once more after the
 * unlock (RC-16); cancelling either dialog changes nothing. The button is busy
 * from the press until the end, dialogs included, and a press meanwhile sends
 * nothing. Any other refusal, such as a limit (RM-13), is shown above the
 * button with its reference.
 */
@Component({
  selector: 'repo-clone-status',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    CollapsibleComponent,
    IconComponent,
    InlineBannerComponent,
    RepositoryStatusDetailComponent
  ],
  templateUrl: './clone-status.component.html',
  styleUrl: './clone-status.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.none]': '!shown()' }
})
export class CloneStatusComponent {
  readonly details = input.required<RepositoryDetails>();

  private readonly api = inject(RepositoriesApi);
  private readonly dialogs = inject(DialogService);
  private readonly document = inject(DOCUMENT);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly store = inject(RepositorySettingsStore);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  private readonly id = nextId++;
  protected readonly headingId = `repo-clone-status-heading-${this.id}`;
  protected readonly regionId = `repo-clone-status-details-${this.id}`;
  protected readonly hintId = `repo-clone-status-hint-${this.id}`;
  protected readonly summary = computed(() => this.details().summary);
  protected readonly shown = computed(() => {
    const status = this.summary().status;
    return status === 'cloning' || status === 'error';
  });
  protected readonly failed = computed(() => this.summary().status === 'error');
  protected readonly action = computed<CloneAction | null>(() => {
    const summary = this.summary();
    if (summary.status !== 'error') {
      return null;
    }
    return summary.error === 'working-copy-missing' ? 'clone-again' : 'retry';
  });
  /** **Retry clone** is described by the hint about its credentials, so that it is heard on the button too. */
  protected readonly describedBy = computed(() => this.action() === 'retry' ? this.hintId : null);
  /**
   * Whether **Details** is open. Closed by default for every error (RM-10), so
   * it closes when the repository leaves **Error**, such as for a retried clone,
   * and stays closed when that clone fails again; a reload in **Error** keeps it.
   */
  protected readonly expanded = linkedSignal({ source: this.failed, computation: () => false });
  /** Whether a press of **Retry clone** or **Clone again** has not ended yet. */
  protected readonly cloning = signal(false);
  /** Why the last press did not clone; gone when the repository leaves **Error**. */
  protected readonly failure = linkedSignal<boolean, ApiErrorText | null>({
    source: this.failed,
    computation: () => null
  });

  protected toggle(): void {
    this.expanded.update(expanded => !expanded);
  }

  /** **Retry clone** or **Clone again**: one request per press, however often it is pressed. */
  protected async clone(): Promise<void> {
    const action = this.action();
    if (action === null || this.cloning()) {
      return;
    }
    this.cloning.set(true);
    this.failure.set(null);
    try {
      // Not when the repository left Error while the warning was open, such as when another tab cloned it.
      if (action === 'clone-again' && (!await this.confirmed() || this.action() !== action)) {
        return;
      }
      await this.send(this.summary().id, true);
    } finally {
      this.cloning.set(false);
    }
  }

  protected async copy(requestId: string): Promise<void> {
    try {
      await this.document.defaultView?.navigator.clipboard.writeText(requestId);
    } catch {
      // Without clipboard access the ID can still be selected and copied by hand.
      return;
    }
    this.toast.show({
      message: this.transloco.translate(`${KEY}.copied`),
      dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
      status: 'success'
    });
  }

  /** The warning of RM-12, with Cancel as the safe choice. */
  private confirmed(): Promise<boolean> {
    return this.dialogs.confirm({
      heading: this.transloco.translate(`${KEY}.confirm.heading`, { name: this.summary().name }),
      message: this.transloco.translate(`${KEY}.confirm.message`),
      confirmLabel: this.transloco.translate(`${KEY}.confirm.confirm`),
      cancelLabel: this.transloco.translate(`${KEY}.confirm.cancel`),
      variant: 'danger'
    });
  }

  /**
   * Sends the request; on `key-locked`, and only when `unlockFirst`, asks for
   * the passphrase and sends once more, so that a key locked again at once
   * shows the refusal instead of asking forever.
   */
  private async send(id: number, unlockFirst: boolean): Promise<void> {
    let apiError: ApiError;
    try {
      this.store.cloning(await firstValueFrom(this.api.cloneAgain(id)));
      return;
    } catch (error) {
      apiError = toApiError(error);
    }
    if (unlockFirst && apiError.code === 'key-locked') {
      const unlock = await this.unlock(id, apiError);
      if (unlock === 'cancelled') {
        return;
      }
      if (unlock === 'unlocked') {
        await this.send(id, false);
        return;
      }
    }
    this.failure.set(this.errorText.describe(apiError));
    if (apiError.code === 'not-found' || apiError.code === 'repository-not-in-error') {
      // Removed, or cloned again from another tab: the page shows what it is now.
      this.store.reload();
    }
  }

  /**
   * Asks for the passphrase of the repository's key (RC-16), whose type and
   * fingerprint the dialog shows, so the credentials in use are read first.
   * `impossible` when they cannot be read or are not the locked key any more.
   */
  private async unlock(id: number, refusal: ApiError): Promise<Unlock> {
    let key: UnlockKeyDialogData;
    try {
      const inUse = (await firstValueFrom(this.api.repositoryCredentials(id))).inUse;
      if (
        inUse?.kind !== 'ssh-key'
        || !inUse.passphraseProtected
        || inUse.missing
        || inUse.id !== Number(refusal.params['keyId'])
      ) {
        return 'impossible';
      }
      if (inUse.unlocked) {
        // Unlocked meanwhile, such as in another tab of this session.
        return 'unlocked';
      }
      key = { id: inUse.id, name: inUse.name, keyType: inUse.keyType, fingerprint: inUse.fingerprint };
    } catch {
      return 'impossible';
    }
    const ref = this.dialogs.open<UnlockKeyDialog, UnlockKeyDialogData, boolean>(UnlockKeyDialog, { data: key });
    return await firstValueFrom(ref.closed, { defaultValue: undefined }) === true ? 'unlocked' : 'cancelled';
  }
}
