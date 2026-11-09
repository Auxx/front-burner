import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonComponent, DIALOG_DATA, DialogComponent, DialogFooterComponent, DialogRef } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

export interface SwitchRefusedData {
  /** The changed files, as of the status read after the refusal. */
  readonly paths: readonly string[];
}

/** More would freeze a phone; **Changes** lists them all. */
const MAX_SHOWN = 200;

/**
 * Says why a switch was refused, with the changed files (GA-39). A dialog, as it
 * answers a choice just made. A long list scrolls in the dialog's body, with
 * **Show changes** in sight below it. Closes with `true` on **Show changes**.
 */
@Component({
  selector: 'rs-switch-refused',
  imports: [ TranslocoDirective, ButtonComponent, DialogComponent, DialogFooterComponent ],
  templateUrl: './switch-refused.dialog.html',
  styleUrl: './switch-refused.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SwitchRefusedDialog {
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  private readonly data = inject(DIALOG_DATA) as SwitchRefusedData;

  protected readonly paths = this.data.paths.slice(0, MAX_SHOWN);
  protected readonly hidden = this.data.paths.length - this.paths.length;
}
