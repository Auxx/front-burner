import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonComponent, DialogComponent, DialogFooterComponent, DialogRef } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * Asks before starting over a file the user edited (GC-18), with the focus on
 * **Cancel**; closes with `true` on **Start over**.
 */
@Component({
  selector: 'rs-start-over',
  imports: [ TranslocoDirective, ButtonComponent, DialogComponent, DialogFooterComponent ],
  templateUrl: './start-over.dialog.html',
  styleUrl: './start-over.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StartOverDialog {
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
}
