import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  type Signal,
  signal,
  viewChild
} from '@angular/core';
import { type ApiError, COMMIT_MESSAGE_MAX_LENGTH, type RepositoryCommitAuthor } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  DIALOG_DATA,
  DialogComponent,
  DialogFooterComponent,
  DialogRef,
  FieldComponent,
  InlineBannerComponent,
  TextareaComponent
} from '@front-burner/ui';
import { type ApiErrorText, ApiErrorTextService } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * How a commit of the merge ended: it was made, the user cancelled the question
 * about their commit author, the merge ended or the repository was left meanwhile,
 * or it failed.
 */
export type CommitMergeOutcome = 'committed' | 'cancelled' | 'ended' | { readonly error: ApiError; };

export interface CommitMergeData {
  /** git's message for the merge commit, to start with (GC-20). */
  readonly message: string;
  /** Who would commit; `null` until it has been read. */
  readonly author: Signal<RepositoryCommitAuthor | null>;
  /** Whether no author can be shown, because reading it failed. */
  readonly authorFailed: Signal<boolean>;
  /** Whether the merge ended, or the user left the repository: the dialog then closes. */
  readonly ended: Signal<boolean>;
  /** **Change** of the commit author (CA-9). */
  changeAuthor(): Promise<void>;
  /** Commits the merge with `message`. */
  commit(message: string): Promise<CommitMergeOutcome>;
}

let nextId = 0;

/**
 * **Commit merge** (GC-20): the merge commit's message, filled in with git's and
 * editable, "Committing as _Name &lt;email&gt;_" with **Change** (CA-9), and
 * **Commit merge**. An empty message is refused beside the field. A failure says
 * why with its reference and keeps the message for another try (GC-27). The dialog
 * closes when the merge was committed, and also, saying nothing, when it ended
 * elsewhere or the user left the repository.
 */
@Component({
  selector: 'rs-commit-merge',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    DialogComponent,
    DialogFooterComponent,
    FieldComponent,
    InlineBannerComponent,
    TextareaComponent
  ],
  templateUrl: './commit-merge.dialog.html',
  styleUrl: './commit-merge.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CommitMergeDialog {
  protected readonly ref = inject<DialogRef<void>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as CommitMergeData;
  private readonly errorText = inject(ApiErrorTextService);
  private readonly field = viewChild.required('messageField', { read: ElementRef<HTMLTextAreaElement> });

  protected readonly formId = `rs-commit-merge-${nextId++}`;
  protected readonly maxLength = COMMIT_MESSAGE_MAX_LENGTH;
  protected readonly message = signal(this.data.message);
  /** The translation key of why the message was refused, until it changes. */
  protected readonly refused = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly failure = signal<ApiErrorText | null>(null);

  constructor() {
    effect(() => {
      if (this.data.ended()) {
        this.ref.close();
      }
    });
  }

  protected typed(event: Event): void {
    this.message.set((event.target as HTMLTextAreaElement).value);
    this.refused.set(null);
  }

  protected changeAuthor(): void {
    if (!this.busy()) {
      void this.data.changeAuthor();
    }
  }

  protected async confirm(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) {
      return;
    }
    const message = this.message();
    const refused = message.trim() === '' ? 'needsMessage' : message.length > this.maxLength ? 'messageTooLong' : null;
    if (refused !== null) {
      this.refused.set(refused);
      this.field().nativeElement.focus();
      return;
    }
    this.busy.set(true);
    this.ref.dismissible.set(false);
    this.failure.set(null);
    try {
      const outcome = await this.data.commit(message);
      if (outcome === 'committed' || outcome === 'ended') {
        this.ref.close();
      } else if (outcome !== 'cancelled') {
        this.failure.set(this.errorText.describe(outcome.error));
      }
    } finally {
      this.busy.set(false);
      this.ref.dismissible.set(true);
    }
  }
}
