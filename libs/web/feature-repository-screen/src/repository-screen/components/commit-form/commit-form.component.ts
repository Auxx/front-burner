import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, viewChild } from '@angular/core';
import { COMMIT_MAX_PATHS, COMMIT_MESSAGE_MAX_LENGTH } from '@front-burner/shared-contracts';
import {
  BannerActionsComponent,
  ButtonComponent,
  CheckboxComponent,
  ChoiceComponent,
  FieldComponent,
  InlineBannerComponent,
  TextareaComponent,
  TooltipDirective
} from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { CommitAuthorGate } from '../../services/commit-author-gate/commit-author-gate.service';
import { CommitService } from '../../services/commit/commit.service';

/** Longer first lines get a hint; nothing is refused (GA-18). */
const SUBJECT_HINT_LENGTH = 72;

/**
 * The commit form below the list of **Changes** (GA-18, GA-19): the message, with
 * a hint for a long first line, who commits with **Change** (CA-9), or a warning
 * if that can't be read, **Amend last commit** when the last commit can be
 * amended (GA-22), and a button that says how many files it commits. While it
 * can't commit, the button keeps the focus and says why on hover, focus or tap.
 * It stays when no change is left, so that the focus is not lost with it.
 */
@Component({
  selector: 'rs-commit-form',
  imports: [
    TranslocoDirective,
    BannerActionsComponent,
    ButtonComponent,
    CheckboxComponent,
    ChoiceComponent,
    FieldComponent,
    InlineBannerComponent,
    TextareaComponent,
    TooltipDirective
  ],
  templateUrl: './commit-form.component.html',
  styleUrl: './commit-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CommitFormComponent {
  protected readonly commit = inject(CommitService);
  protected readonly gate = inject(CommitAuthorGate);
  private readonly commitButton = viewChild.required('commitButton', { read: ElementRef<HTMLElement> });

  protected readonly count = computed(() => this.commit.paths().length);
  protected readonly longSubject = computed(() => this.commit.message().split('\n', 1)[0].length > SUBJECT_HINT_LENGTH);
  protected readonly subjectHintLength = SUBJECT_HINT_LENGTH;
  protected readonly maxPaths = COMMIT_MAX_PATHS;
  protected readonly maxMessageLength = COMMIT_MESSAGE_MAX_LENGTH;

  /** The translation key of why the button can't commit, if it can't. */
  protected readonly blocked = computed(() => {
    if (this.commit.message().trim() === '') {
      return 'needsMessage';
    }
    if (this.commit.message().length > COMMIT_MESSAGE_MAX_LENGTH) {
      return 'messageTooLong';
    }
    if (this.count() === 0 && !this.commit.amending()) {
      return 'needsFile';
    }
    return this.count() > COMMIT_MAX_PATHS ? 'tooManyFiles' : null;
  });

  protected submit(): void {
    if (this.blocked() === null) {
      void this.commit.commit(this.commit.message());
    }
  }

  protected changeAuthor(): void {
    if (!this.commit.busy()) {
      void this.gate.change();
    }
  }

  /** The warning goes with the button that asked, so the focus moves first. */
  protected retryAuthor(): void {
    (this.commitButton().nativeElement as HTMLElement).focus();
    this.gate.refresh();
  }

  /** The banner goes with the button that asked, so the focus moves first. */
  protected retry(): void {
    (this.commitButton().nativeElement as HTMLElement).focus();
    this.submit();
  }

  protected typed(event: Event): void {
    this.commit.message.set((event.target as HTMLTextAreaElement).value);
  }
}
