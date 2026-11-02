import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { CommitAuthor } from '@front-burner/shared-contracts';
import { KeyValueComponent, KeyValueListComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/** A commit author, read-only, under the same labels as `CommitAuthorFormComponent` (CA-9). */
@Component({
  selector: 'dlg-commit-author-summary',
  imports: [ TranslocoDirective, KeyValueComponent, KeyValueListComponent ],
  templateUrl: './commit-author-summary.component.html',
  styleUrl: './commit-author-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CommitAuthorSummaryComponent {
  readonly author = input.required<CommitAuthor>();
}
