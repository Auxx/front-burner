import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { RepositoryCommitAuthor } from '@front-burner/shared-contracts';
import { DialogRef } from '@front-burner/ui';

import { CommitAuthorEditorComponent } from '../../components/commit-author-editor/commit-author-editor.component';

/**
 * **Change** on the commit form (CA-9): edits the commit author, as the default
 * or for this repository. Opened with `CommitAuthorDialogData`; it closes with the
 * author that now applies, or with nothing when cancelled.
 */
@Component({
  selector: 'dlg-change-commit-author',
  imports: [ CommitAuthorEditorComponent ],
  templateUrl: './change-commit-author.dialog.html',
  styleUrl: './change-commit-author.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChangeCommitAuthorDialog {
  protected readonly ref = inject<DialogRef<RepositoryCommitAuthor>>(DialogRef);
}
