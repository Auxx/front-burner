import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonComponent, DialogComponent, DialogFooterComponent, DialogRef } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/** Asks before aborting the merge, with the focus on **Cancel** (GC-23); closes with `true` on **Abort merge**. */
@Component({
  selector: 'rs-abort-merge',
  imports: [ TranslocoDirective, ButtonComponent, DialogComponent, DialogFooterComponent ],
  templateUrl: './abort-merge.dialog.html',
  styleUrl: './abort-merge.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AbortMergeDialog {
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
}
