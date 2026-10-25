import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ButtonComponent } from '../../../controls/components/button/button.component';
import { DialogRef } from '../../services/dialog/dialog-ref';
import { type ConfirmOptions, DIALOG_DATA } from '../../services/dialog/dialog.model';
import { DialogFooterComponent } from '../dialog-footer/dialog-footer.component';
import { DialogComponent } from '../dialog/dialog.component';

/** The dialog of `DialogService.confirm()`. Cancel, the safe choice, gets the focus. */
@Component({
  selector: 'ui-confirm-dialog',
  imports: [ ButtonComponent, DialogComponent, DialogFooterComponent ],
  templateUrl: './confirm-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConfirmDialogComponent {
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  protected readonly options = inject(DIALOG_DATA) as ConfirmOptions;
}
