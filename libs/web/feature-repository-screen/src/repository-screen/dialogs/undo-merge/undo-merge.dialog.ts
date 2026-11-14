import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonComponent, DialogComponent, DialogFooterComponent, DialogRef } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/** Asks before undoing the merge, with the focus on **Cancel** (GC-26); closes with `true` on **Undo merge**. */
@Component({
  selector: 'rs-undo-merge',
  imports: [ TranslocoDirective, ButtonComponent, DialogComponent, DialogFooterComponent ],
  templateUrl: './undo-merge.dialog.html',
  styleUrl: './undo-merge.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UndoMergeDialog {
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
}
