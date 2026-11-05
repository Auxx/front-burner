import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { COMMIT_MAX_PATHS } from '@front-burner/shared-contracts';
import {
  BannerActionsComponent,
  ButtonComponent,
  FieldComponent,
  InlineBannerComponent,
  TextareaComponent,
  TooltipDirective
} from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { CommitTicksService } from '../../services/commit-ticks/commit-ticks.service';
import { CommitService } from '../../services/commit/commit.service';

/** Longer first lines get a hint; nothing is refused (GA-18). */
const SUBJECT_HINT_LENGTH = 72;

/**
 * The commit form below the list of **Changes** (GA-18, GA-19): the message, with
 * a hint for a long first line, and a button that says how many files it
 * commits. While it can't commit, the button keeps the focus and says why on
 * hover, focus or tap. It stays when no change is left, so that the focus is not
 * lost with it.
 */
@Component({
  selector: 'rs-commit-form',
  imports: [
    TranslocoDirective,
    BannerActionsComponent,
    ButtonComponent,
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
  private readonly ticks = inject(CommitTicksService);

  protected readonly count = computed(() => this.ticks.ticked().length);
  protected readonly longSubject = computed(() => this.commit.message().split('\n', 1)[0].length > SUBJECT_HINT_LENGTH);
  protected readonly subjectHintLength = SUBJECT_HINT_LENGTH;
  protected readonly maxPaths = COMMIT_MAX_PATHS;

  /** The translation key of why the button can't commit, if it can't. */
  protected readonly blocked = computed(() => {
    if (this.commit.message().trim() === '') {
      return 'needsMessage';
    }
    if (this.count() === 0) {
      return 'needsFile';
    }
    return this.count() > COMMIT_MAX_PATHS ? 'tooManyFiles' : null;
  });

  protected submit(): void {
    if (this.blocked() === null) {
      void this.commit.commit(this.commit.message());
    }
  }

  protected typed(event: Event): void {
    this.commit.message.set((event.target as HTMLTextAreaElement).value);
  }
}
