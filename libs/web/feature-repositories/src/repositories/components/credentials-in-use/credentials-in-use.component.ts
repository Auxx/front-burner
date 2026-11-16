import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, type OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { PushEvent, RepositoryCredentialsInfo, RepositorySummary } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  DialogService,
  InlineBannerComponent,
  KeyValueComponent,
  KeyValueListComponent,
  SpinnerComponent
} from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { PushChannelService, toApiError } from '@front-burner/web-core';
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
 * Credentials whose secret an encryption key reset deleted say so, since
 * only other credentials help then (NF-8.6).
 *
 * **Change credentials** opens the repository credentials dialog (RC-7,
 * RC-11) in every status, so that a failed clone can be retried with others
 * (RM-11). Saving there is the end: the section reads the credentials again,
 * and so does the page's store, since new credentials may clear a warning.
 * {@link change} is public, for the fixes of the warnings.
 *
 * Credentials can also change in another tab or on another device, which
 * sends no event of its own: the section reads them again on the events that
 * make the page's store read the details again (the repository's
 * `repository.status` and `repository.warning`), and after a reconnect.
 * Only the latest answer counts. The page shows this section for one
 * repository only, and another repository gets a new section.
 */
@Component({
  selector: 'repo-credentials-in-use',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    InlineBannerComponent,
    KeyValueListComponent,
    KeyValueComponent,
    SpinnerComponent
  ],
  templateUrl: './credentials-in-use.component.html',
  styleUrl: './credentials-in-use.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CredentialsInUseComponent implements OnInit {
  readonly repository = input.required<RepositorySummary>();

  private readonly api = inject(RepositoriesApi);
  private readonly dialogs = inject(DialogService);
  private readonly store = inject(RepositorySettingsStore);

  protected readonly info = signal<RepositoryCredentialsInfo | null>(null);
  protected readonly state = signal<CredentialsState>('loading');
  /** Whether the dialog is open: **Change credentials** is busy meanwhile. */
  protected readonly changing = signal(false);

  private request: Subscription | undefined;
  /** The dialog that is open, which a second {@link change} waits for instead of opening another. */
  private open: Promise<boolean> | undefined;
  private destroyed = false;

  constructor() {
    const push = inject(PushChannelService);
    const destroyRef = inject(DestroyRef);
    push.events.pipe(takeUntilDestroyed(destroyRef)).subscribe(event => {
      if (this.concerns(event)) {
        this.load();
      }
    });
    push.reconnected.pipe(takeUntilDestroyed(destroyRef)).subscribe(() => this.load());
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.request?.unsubscribe();
    });
  }

  ngOnInit(): void {
    this.load();
  }

  /**
   * Opens the repository credentials dialog with `options`; resolves to
   * `true` once it saved, after which the section and the page's store read
   * again, and to `false` when it was cancelled. While a dialog is open, a
   * second call opens none and resolves as the open one does.
   */
  change(options: Omit<RepositoryCredentialsDialogData, 'repository'> = {}): Promise<boolean> {
    this.open ??= this.openDialog(options).finally(() => {
      this.open = undefined;
      this.changing.set(false);
    });
    return this.open;
  }

  /** **Try again** after the credentials could not be read. */
  protected retry(): void {
    this.load();
  }

  private async openDialog(options: Omit<RepositoryCredentialsDialogData, 'repository'>): Promise<boolean> {
    this.changing.set(true);
    const ref = this.dialogs.open<RepositoryCredentialsDialog, RepositoryCredentialsDialogData, boolean>(
      RepositoryCredentialsDialog,
      { data: { repository: this.repository(), ...options } }
    );
    const saved = await firstValueFrom(ref.closed, { defaultValue: undefined }) === true;
    // Not after the page has gone: it has nothing to show them on.
    if (saved && !this.destroyed) {
      this.load();
      this.store.reload();
    }
    return saved;
  }

  private concerns(event: PushEvent): boolean {
    return (event.type === 'repository.status' || event.type === 'repository.warning')
      && event.repositoryId === this.repository().id;
  }

  /**
   * Reads the credentials in use; only the latest answer counts, and a failed
   * reload keeps those shown. A repository that is gone, or is not the
   * user's, is the page's to show: its store reads the details again and
   * finds that it is missing (RM-1).
   */
  private load(): void {
    if (this.info() === null) {
      this.state.set('loading');
    }
    this.request?.unsubscribe();
    this.request = this.api.repositoryCredentials(this.repository().id).subscribe({
      next: info => {
        this.info.set(info);
        this.state.set('ready');
      },
      error: (error: unknown) => {
        if (toApiError(error).code === 'not-found') {
          this.store.reload();
        } else if (this.info() === null) {
          this.state.set('failed');
        }
      }
    });
  }
}
