import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { ApiError } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  DIALOG_DATA,
  DialogComponent,
  DialogFooterComponent,
  DialogRef,
  InlineBannerComponent
} from '@front-burner/ui';
import { PreferencesApi } from '@front-burner/web-api-client';
import { type ApiErrorText, ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { CommitAuthorEditorComponent } from '../../components/commit-author-editor/commit-author-editor.component';
import { CommitAuthorSummaryComponent } from '../../components/commit-author-summary/commit-author-summary.component';
import type { CommitAuthorDialogData } from '../../models/commit-author-dialog.model';
import { COMMIT_EMAIL_HELP } from '../../models/commit-author-help';

/** The answer of a user who has confirmed their commit author. */
export type CommitAuthorConfirmed = 'confirmed';

/**
 * The question before a user's first commit (CA-12): **Commit as _Name
 * &lt;email&gt;_**, or **Change**, which edits the author in place. It closes with
 * `'confirmed'` once the backend has it, or with nothing when cancelled, which
 * cancels the commit. A failure keeps it open with the reason; a default that the
 * backend refuses to confirm opens the form, with the reason next to its field.
 */
@Component({
  selector: 'dlg-confirm-commit-author',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    CommitAuthorEditorComponent,
    CommitAuthorSummaryComponent,
    DialogComponent,
    DialogFooterComponent,
    InlineBannerComponent
  ],
  templateUrl: './confirm-commit-author.dialog.html',
  styleUrl: './confirm-commit-author.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConfirmCommitAuthorDialog {
  protected readonly ref = inject<DialogRef<CommitAuthorConfirmed>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as CommitAuthorDialogData;
  private readonly api = inject(PreferencesApi);
  private readonly errorText = inject(ApiErrorTextService);

  protected readonly help = COMMIT_EMAIL_HELP;
  protected readonly changing = signal(false);
  protected readonly refusal = signal<ApiError | null>(null);
  protected readonly failure = signal<ApiErrorText | null>(null);
  protected readonly busy = signal(false);

  protected async confirm(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    this.ref.dismissible.set(false);
    this.failure.set(null);
    try {
      await firstValueFrom(this.api.confirmCommitAuthor());
      this.ref.close('confirmed');
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.fields?.length) {
        this.refusal.set(apiError);
        this.changing.set(true);
      } else {
        this.failure.set(this.errorText.describe(apiError));
      }
    } finally {
      this.busy.set(false);
      this.ref.dismissible.set(true);
    }
  }
}
