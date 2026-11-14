import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonComponent, DialogComponent, DialogFooterComponent, DialogRef } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * Asks before marking a file that still has conflict markers as resolved (GC-14),
 * with the focus on **Cancel**; closes with `true` on **Mark as resolved**.
 */
@Component({
  selector: 'rs-markers-left',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    DialogComponent,
    DialogFooterComponent
  ],
  templateUrl: './markers-left.dialog.html',
  styleUrl: './markers-left.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MarkersLeftDialog {
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
}
