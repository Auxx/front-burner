import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, type OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { RepositoryCommitAuthor, RepositorySummary } from '@front-burner/shared-contracts';
import { ButtonComponent, DialogService, InlineBannerComponent, SpinnerComponent } from '@front-burner/ui';
import { PreferencesApi } from '@front-burner/web-api-client';
import { type ApiErrorText, ApiErrorTextService, PushChannelService, toApiError } from '@front-burner/web-core';
import { ChangeCommitAuthorDialog, type CommitAuthorDialogData } from '@front-burner/web-repository-dialogs';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom, type Subscription } from 'rxjs';

import { RepositorySettingsStore } from '../../services/repository-settings-store/repository-settings-store.service';

/** Where the section is with the author in use. */
type AuthorState = 'loading' | 'ready' | 'failed';

/**
 * The **Commit author** section of the settings page (RM-15, CA-9): the
 * commit author that commits in this repository use, "Commits use _Name
 * &lt;email&gt;_", and whether it is the user's default or an override.
 *
 * **Use a different author for this repository** opens the commit author
 * dialog for the override only, starting from the author in use. With an
 * override, **Use my default** removes it at once, without asking: the
 * override is one click to set again, and the default stays as it is (CA-8).
 * A failure says why, and changes nothing.
 *
 * The default can change in another tab, such as on the Preferences page,
 * and an override on another device: the section reads the author again on
 * `commit-author.changed` and after a reconnect, as events are never replayed
 * (A-3.11). Only the latest answer counts. Shown in every status, as an
 * override can be set before the clone ends.
 */
@Component({
  selector: 'repo-repository-commit-author',
  imports: [ TranslocoDirective, ButtonComponent, InlineBannerComponent, SpinnerComponent ],
  templateUrl: './repository-commit-author.component.html',
  styleUrl: './repository-commit-author.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositoryCommitAuthorComponent implements OnInit {
  readonly repository = input.required<RepositorySummary>();

  private readonly api = inject(PreferencesApi);
  private readonly dialogs = inject(DialogService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly store = inject(RepositorySettingsStore);

  protected readonly author = signal<RepositoryCommitAuthor | null>(null);
  protected readonly state = signal<AuthorState>('loading');
  /** Whether the dialog is open: its button is busy meanwhile. */
  protected readonly changing = signal(false);
  /** Whether **Use my default** is on its way. */
  protected readonly resetting = signal(false);
  /** Why the last change failed, above the buttons. */
  protected readonly failure = signal<ApiErrorText | null>(null);

  private request: Subscription | undefined;
  private destroyed = false;

  constructor() {
    const push = inject(PushChannelService);
    const destroyRef = inject(DestroyRef);
    push.events.pipe(takeUntilDestroyed(destroyRef)).subscribe(event => {
      if (event.type === 'commit-author.changed') {
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

  /** **Use a different author for this repository**: the dialog, for the override only. */
  protected async change(current: RepositoryCommitAuthor): Promise<void> {
    if (this.changing()) {
      return;
    }
    this.changing.set(true);
    this.failure.set(null);
    try {
      const ref = this.dialogs.open<ChangeCommitAuthorDialog, CommitAuthorDialogData, RepositoryCommitAuthor>(
        ChangeCommitAuthorDialog,
        { data: { repositoryId: this.repository().id, current, overrideOnly: true } }
      );
      const saved = await firstValueFrom(ref.closed, { defaultValue: undefined });
      if (saved !== undefined && !this.destroyed) {
        this.show(saved);
      }
    } finally {
      this.changing.set(false);
    }
  }

  /** **Use my default**: removes the override, without asking (CA-8). */
  protected async useDefault(): Promise<void> {
    if (this.resetting()) {
      return;
    }
    this.resetting.set(true);
    this.failure.set(null);
    try {
      this.show(await firstValueFrom(this.api.removeRepositoryCommitAuthor(this.repository().id)));
    } catch (error) {
      this.failed(error);
    } finally {
      this.resetting.set(false);
    }
  }

  /** **Try again** after the author could not be read. */
  protected retry(): void {
    this.load();
  }

  /** Shows an author the backend answered a change with; a read on its way would only be older. */
  private show(author: RepositoryCommitAuthor): void {
    this.request?.unsubscribe();
    this.author.set(author);
    this.state.set('ready');
  }

  private failed(error: unknown): void {
    const apiError = toApiError(error);
    if (apiError.code === 'not-found') {
      this.store.reload();
    } else {
      this.failure.set(this.errorText.describe(apiError));
    }
  }

  /**
   * Reads the author in use; only the latest answer counts, and a failed
   * reload keeps the author shown. A repository that is gone, or is not the
   * user's, is the page's to show: its store reads the details again and
   * finds that it is missing (RM-1).
   */
  private load(): void {
    if (this.author() === null) {
      this.state.set('loading');
    }
    this.request?.unsubscribe();
    this.request = this.api.repositoryCommitAuthor(this.repository().id).subscribe({
      next: author => {
        this.author.set(author);
        this.state.set('ready');
      },
      error: (error: unknown) => {
        if (toApiError(error).code === 'not-found') {
          this.store.reload();
        } else if (this.author() === null) {
          this.state.set('failed');
        }
      }
    });
  }
}
