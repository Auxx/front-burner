import {
  afterNextRender,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  input,
  type OnInit,
  output,
  signal
} from '@angular/core';
import { submit } from '@angular/forms/signals';
import type { ApiError, CommitAuthor, RepositoryCommitAuthor } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  type ChoiceOption,
  DIALOG_DATA,
  DialogComponent,
  DialogFooterComponent,
  DialogRef,
  InlineBannerComponent,
  SegmentedControlComponent
} from '@front-burner/ui';
import { PreferencesApi } from '@front-burner/web-api-client';
import { type ApiErrorText, ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import type { CommitAuthorDialogData } from '../../models/commit-author-dialog.model';
import { commitAuthorForm } from '../../models/commit-author-form.model';
import { CommitAuthorRefusals } from '../../models/commit-author-refusals';
import { CommitAuthorFormComponent } from '../commit-author-form/commit-author-form.component';

/** What **Change** edits (CA-9). */
type Scope = 'default' | 'repository';

const KEY = 'web-repository-dialogs.CommitAuthorEditorComponent';

let nextId = 0;

/**
 * The content of a dialog that edits a commit author, as the default or for this
 * repository (CA-9, CA-12), for a dialog opened with `CommitAuthorDialogData`. The
 * first choice is the one the repository uses now. A failure keeps it open, so
 * that nothing goes on with the old author.
 *
 * An override beats the default (CA-6), so saving as the default also removes this
 * repository's override, which the dialog says: the next commit records what the
 * user typed.
 *
 * With `confirming`, for the first commit's question, saving also confirms: saving
 * the default does so itself, and an override is followed by the confirmation,
 * which concerns the default (plan 42). If the backend refuses that default, the
 * form moves on to it, with the reason next to its field (CA-12). Correcting it
 * leaves any override alone: the commit is still made as the question said.
 */
@Component({
  selector: 'dlg-commit-author-editor',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    CommitAuthorFormComponent,
    DialogComponent,
    DialogFooterComponent,
    InlineBannerComponent,
    SegmentedControlComponent
  ],
  templateUrl: './commit-author-editor.component.html',
  styleUrl: './commit-author-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CommitAuthorEditorComponent implements OnInit {
  /** Whether saving confirms the commit author, and the commit goes on. */
  readonly confirming = input(false, { transform: booleanAttribute });
  /** The backend's refusal of the default, which the user came here to fix. */
  readonly refusal = input<ApiError | null>(null);

  readonly saved = output<RepositoryCommitAuthor>();
  readonly cancelled = output<void>();

  private readonly ref = inject(DialogRef);
  private readonly data = inject(DIALOG_DATA) as CommitAuthorDialogData;
  private readonly api = inject(PreferencesApi);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly injector = inject(Injector);
  private readonly transloco = inject(TranslocoService);

  protected readonly formId = `dlg-commit-author-editor-${nextId++}`;
  protected readonly model = commitAuthorForm(this.data.current.author);
  protected readonly refusals = new CommitAuthorRefusals(this.model);
  protected readonly scope = signal<Scope | undefined>(
    this.data.current.source === 'override' ? 'repository' : 'default'
  );
  protected readonly scopes = computed<readonly ChoiceOption<Scope>[]>(() => {
    // Re-evaluated when the language changes.
    this.transloco.activeLang();
    return [
      { value: 'default', label: this.transloco.translate(`${KEY}.asDefault`) },
      { value: 'repository', label: this.transloco.translate(`${KEY}.forRepository`) }
    ];
  });
  protected readonly failure = signal<ApiErrorText | null>(null);
  /** Whether the form shows a default that the backend refused to confirm. */
  protected readonly fixingDefault = signal(false);
  protected readonly dropsOverride = computed(() =>
    this.scope() === 'default' && this.data.current.source === 'override' && !this.fixingDefault()
  );

  ngOnInit(): void {
    const refusal = this.refusal();
    if (refusal !== null) {
      void this.fixDefault(refusal);
    }
  }

  protected cancel(): void {
    this.cancelled.emit();
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    this.ref.dismissible.set(false);
    try {
      await submit(this.model, {
        action: async () => {
          await this.send(this.model().value());
          return undefined;
        },
        onInvalid: () => this.afterRender(() => this.refusals.focusFirstError())
      });
    } finally {
      this.ref.dismissible.set(true);
    }
  }

  private async send(value: CommitAuthor): Promise<void> {
    this.failure.set(null);
    this.refusals.clear();
    try {
      const saved = await (this.scope() === 'default' ? this.saveDefault(value) : this.saveOverride(value));
      if (saved !== null) {
        this.saved.emit(saved);
      }
    } catch (error) {
      this.refused(value, toApiError(error));
    }
  }

  private async saveDefault(value: CommitAuthor): Promise<RepositoryCommitAuthor> {
    const preference = await firstValueFrom(this.api.setCommitAuthor(value));
    return this.dropsOverride()
      ? firstValueFrom(this.api.removeRepositoryCommitAuthor(this.data.repositoryId))
      : { ...preference, source: 'default' };
  }

  /** Resolves `null` when the form has moved on to a default that can't be confirmed. */
  private async saveOverride(value: CommitAuthor): Promise<RepositoryCommitAuthor | null> {
    const saved = await firstValueFrom(this.api.setRepositoryCommitAuthor(this.data.repositoryId, value));
    if (!this.confirming()) {
      return saved;
    }
    try {
      await firstValueFrom(this.api.confirmCommitAuthor());
    } catch (error) {
      const refusal = toApiError(error);
      if (!refusal.fields?.length) {
        throw error;
      }
      await this.fixDefault(refusal);
      return null;
    }
    return { ...saved, confirmed: true };
  }

  /** Puts each field failure on its field; anything else goes above the buttons. */
  private refused(value: CommitAuthor, error: ApiError): void {
    if (this.refusals.record(value, error)) {
      this.afterRender(() => this.refusals.focusFirstError());
    } else {
      this.failure.set(this.errorText.describe(error));
    }
  }

  /** Shows the default that the backend refused to confirm, with the reason next to its field. */
  private async fixDefault(error: ApiError): Promise<void> {
    try {
      const { author } = await firstValueFrom(this.api.commitAuthor());
      this.fixingDefault.set(true);
      this.scope.set('default');
      this.model().reset(author);
      this.refusals.record(author, error);
      this.afterRender(() => this.refusals.focusFirstError());
    } catch (readError) {
      this.failure.set(this.errorText.describe(toApiError(readError)));
    }
  }

  private afterRender(action: () => void): void {
    afterNextRender(action, { injector: this.injector });
  }
}
