import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild
} from '@angular/core';
import { submit } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import type { CommitAuthor, CommitAuthorPreference, FieldError } from '@front-burner/shared-contracts';
import {
  BreadcrumbDirective,
  ButtonComponent,
  InlineBannerComponent,
  KeyValueComponent,
  KeyValueListComponent,
  PageComponent,
  PageTitleDirective,
  SpinnerComponent
} from '@front-burner/ui';
import { PreferencesApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { commitAuthorForm, CommitAuthorFormComponent } from '@front-burner/web-repository-dialogs';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

const FORM_FIELDS: readonly string[] = [ 'name', 'email' ] satisfies (keyof CommitAuthor)[];

type Author =
  | { kind: 'loading'; }
  | { kind: 'failed'; }
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
    KeyValueComponent,
    KeyValueListComponent,
    SpinnerComponent,
    CommitAuthorFormComponent
  ],
  templateUrl: './preferences.page.html',
  styleUrl: './preferences.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreferencesPage {
  private readonly api = inject(PreferencesApi);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly injector = inject(Injector);

  private readonly editButton = viewChild<unknown, ElementRef<HTMLElement>>('editButton', { read: ElementRef });

  protected readonly state = signal<Author>({ kind: 'loading' });
  protected readonly retrying = signal(false);
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  /** A failure that concerns no field, shown above the buttons. */
  protected readonly failure = signal<{ text: string; reference: string | null; } | null>(null);
  protected readonly model = commitAuthorForm({ name: '', email: '' });
  /** The backend's field errors of the last save, with the values it refused. */
  private readonly refused = signal<{ value: CommitAuthor; fields: readonly FieldError[]; } | null>(null);
  /** Each refusal stays on its field until that field changes. */
  protected readonly serverErrors = computed<FieldError[]>(() => {
    const refused = this.refused();
    if (refused === null) {
      return [];
    }
    const value = this.model().value();
    const same = (path: string) => refused.value[path as keyof CommitAuthor] === value[path as keyof CommitAuthor];
    return refused.fields.filter(field => same(field.path));
  });

  constructor() {
    void this.load();
  }

  protected async retry(): Promise<void> {
    this.retrying.set(true);
    await this.load();
    this.retrying.set(false);
  }

  protected edit(author: CommitAuthor): void {
    this.model().reset(author);
    this.refused.set(null);
    this.failure.set(null);
    this.saved.set(false);
    this.editing.set(true);
    afterNextRender(() => this.model.name().focusBoundControl(), { injector: this.injector });
  }

  protected cancel(): void {
    this.leaveForm();
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) {
      return;
    }
    await submit(this.model, async () => {
      const value = this.model().value();
      this.saving.set(true);
      this.failure.set(null);
      this.refused.set(null);
      try {
        this.show(await firstValueFrom(this.api.setCommitAuthor(value)));
        this.saved.set(true);
        this.leaveForm();
      } catch (error) {
        this.refusal(value, error);
      } finally {
        this.saving.set(false);
      }
      return undefined;
    });
  }

  private async load(): Promise<void> {
    try {
      this.show(await firstValueFrom(this.api.commitAuthor()));
    } catch {
      this.state.set({ kind: 'failed' });
    }
  }

  private show(preference: CommitAuthorPreference): void {
    this.state.set({ kind: 'loaded', author: preference.author });
  }

  private leaveForm(): void {
    this.editing.set(false);
    afterNextRender(() => this.editButton()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Puts each field failure on its field; anything else goes above the buttons. */
  private refusal(value: CommitAuthor, error: unknown): void {
    const apiError = toApiError(error);
    const fields = apiError.fields?.filter(field => FORM_FIELDS.includes(field.path)) ?? [];
    if (fields.length > 0) {
      this.refused.set({ value, fields });
    } else {
      this.failure.set(this.errorText.describe(apiError));
    }
  }
}
