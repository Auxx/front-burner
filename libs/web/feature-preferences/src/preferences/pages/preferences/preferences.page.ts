import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild
} from '@angular/core';
import { submit } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import type { CommitAuthor, CommitAuthorPreference } from '@front-burner/shared-contracts';
import {
  BreadcrumbDirective,
  ButtonComponent,
  InlineBannerComponent,
  PageComponent,
  PageTitleDirective,
  SpinnerComponent
} from '@front-burner/ui';
import { PreferencesApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import {
  commitAuthorForm,
  CommitAuthorFormComponent,
  CommitAuthorRefusals,
  CommitAuthorSummaryComponent
} from '@front-burner/web-repository-dialogs';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

interface FailureText {
  text: string;
  reference: string | null;
}

type Author =
  | { kind: 'loading'; }
  | { kind: 'failed'; failure: FailureText; }
  | { kind: 'loaded'; author: CommitAuthor; };

/**
 * The user preferences (CA-9): the default commit author, read-only with
 * **Edit**. The form only appears once the author has loaded, so that a failed
 * load can't be saved over the real author.
 */
@Component({
  selector: 'pref-preferences',
  imports: [
    TranslocoDirective,
    RouterLink,
    PageComponent,
    PageTitleDirective,
    BreadcrumbDirective,
    ButtonComponent,
    InlineBannerComponent,
    SpinnerComponent,
    CommitAuthorFormComponent,
    CommitAuthorSummaryComponent
  ],
  templateUrl: './preferences.page.html',
  styleUrl: './preferences.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreferencesPage {
  private readonly api = inject(PreferencesApi);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  private readonly editButton = viewChild<unknown, ElementRef<HTMLElement>>('editButton', { read: ElementRef });

  protected readonly state = signal<Author>({ kind: 'loading' });
  protected readonly editing = signal(false);
  protected readonly saved = signal(false);
  /** A failure that concerns no field, shown above the buttons. */
  protected readonly failure = signal<FailureText | null>(null);
  protected readonly model = commitAuthorForm({ name: '', email: '' });
  protected readonly refusals = new CommitAuthorRefusals(this.model);

  constructor() {
    void this.load();
  }

  /** Back to loading, so that a second failure brings a new banner, which is announced again. */
  protected retry(): Promise<void> {
    this.state.set({ kind: 'loading' });
    return this.load();
  }

  protected edit(author: CommitAuthor): void {
    this.model().reset(author);
    this.refusals.clear();
    this.failure.set(null);
    this.saved.set(false);
    this.editing.set(true);
    this.afterRender(() => this.model.name().focusBoundControl());
  }

  protected cancel(): void {
    this.leaveForm();
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.model, {
      action: async () => {
        await this.send(this.model().value());
        return undefined;
      },
      onInvalid: () => this.afterRender(() => this.refusals.focusFirstError())
    });
  }

  private async send(value: CommitAuthor): Promise<void> {
    this.failure.set(null);
    this.refusals.clear();
    let preference: CommitAuthorPreference;
    try {
      preference = await firstValueFrom(this.api.setCommitAuthor(value));
    } catch (error) {
      this.refusal(value, error);
      return;
    }
    this.show(preference);
    this.saved.set(true);
    this.leaveForm();
  }

  private async load(): Promise<void> {
    try {
      this.show(await firstValueFrom(this.api.commitAuthor()));
    } catch (error) {
      this.state.set({ kind: 'failed', failure: this.errorText.describe(toApiError(error)) });
    }
  }

  private show(preference: CommitAuthorPreference): void {
    this.state.set({ kind: 'loaded', author: preference.author });
  }

  private leaveForm(): void {
    this.editing.set(false);
    this.afterRender(() => this.editButton()?.nativeElement.focus());
  }

  /** Puts each field failure on its field; anything else goes above the buttons. */
  private refusal(value: CommitAuthor, error: unknown): void {
    const apiError = toApiError(error);
    if (this.refusals.record(value, apiError)) {
      this.afterRender(() => this.refusals.focusFirstError());
    } else {
      this.failure.set(this.errorText.describe(apiError));
    }
  }

  /** Runs `action` once the page has rendered, unless the user has left it by then. */
  private afterRender(action: () => void): void {
    if (!this.destroyRef.destroyed) {
      afterNextRender(action, { injector: this.injector });
    }
  }
}
