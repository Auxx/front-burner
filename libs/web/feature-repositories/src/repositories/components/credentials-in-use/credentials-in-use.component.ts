import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked
} from '@angular/core';
import type { RepositoryCredentialsInfo, RepositorySummary } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  DialogService,
  KeyValueComponent,
  KeyValueListComponent,
  SpinnerComponent
} from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import {
  RepositoryCredentialsDialog,
  type RepositoryCredentialsDialogData
} from '@front-burner/web-repository-dialogs';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom, type Subscription } from 'rxjs';

import { RepositorySettingsStore } from '../../services/repository-settings-store/repository-settings-store.service';

/** Where the section is with the credentials in use. */
type CredentialsState = 'loading' | 'ready' | 'failed';

/**
 * The **Credentials** section of the settings page (RM-14): the credentials
 * the repository uses as a key-value list (A-10.50), never their secret: the
 * name and kind, with the username of HTTPS credentials, or the type,
 * fingerprint and passphrase protection of an SSH key; or "No credentials
 * (public repository)". The API's answer holds public parts only (A-3.5).
 *
 * **Change credentials** opens the repository credentials dialog (RC-7,
 * RC-11) in every status, so that a failed clone can be retried with others
 * (RM-11). Saving there is the end: the section reads the credentials again,
 * and so does the page's store, since new credentials may clear a warning.
 * {@link change} is public, for the fixes of the warnings.
 */
@Component({
  selector: 'repo-credentials-in-use',
  imports: [ TranslocoDirective, ButtonComponent, KeyValueListComponent, KeyValueComponent, SpinnerComponent ],
  templateUrl: './credentials-in-use.component.html',
  styleUrl: './credentials-in-use.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CredentialsInUseComponent {
  readonly repository = input.required<RepositorySummary>();

  private readonly api = inject(RepositoriesApi);
  private readonly dialogs = inject(DialogService);
  private readonly store = inject(RepositorySettingsStore);

  protected readonly info = signal<RepositoryCredentialsInfo | null>(null);
  protected readonly state = signal<CredentialsState>('loading');
  /** Whether the dialog is open, so that a second press opens no second one. */
  protected readonly changing = signal(false);

  private readonly id = computed(() => this.repository().id);
  private request: Subscription | undefined;

  constructor() {
    effect(() => {
      this.id();
      // Another repository's credentials are never shown for this one.
      untracked(() => {
        this.info.set(null);
        this.load();
      });
    });
    inject(DestroyRef).onDestroy(() => this.request?.unsubscribe());
  }

  /**
   * Opens the repository credentials dialog with `options`; resolves to
   * `true` once it saved, after which the section and the page's store read
   * again. Cancelling changes nothing.
   */
  async change(options: Omit<RepositoryCredentialsDialogData, 'repository'> = {}): Promise<boolean> {
    if (this.changing()) {
      return false;
    }
    this.changing.set(true);
    try {
      const ref = this.dialogs.open<RepositoryCredentialsDialog, RepositoryCredentialsDialogData, boolean>(
        RepositoryCredentialsDialog,
        { data: { repository: this.repository(), ...options } }
      );
      const saved = await firstValueFrom(ref.closed, { defaultValue: undefined }) === true;
      if (saved) {
        this.load();
        this.store.reload();
      }
      return saved;
    } finally {
      this.changing.set(false);
    }
  }

  /** **Try again** after the credentials could not be read. */
  protected retry(): void {
    this.load();
  }

  /** Reads the credentials in use; only the latest answer counts, and a failed reload keeps those shown. */
  private load(): void {
    if (this.info() === null) {
      this.state.set('loading');
    }
    this.request?.unsubscribe();
    this.request = this.api.repositoryCredentials(this.id()).subscribe({
      next: info => {
        this.info.set(info);
        this.state.set('ready');
      },
      error: () => {
        if (this.info() === null) {
          this.state.set('failed');
        }
      }
    });
  }
}
