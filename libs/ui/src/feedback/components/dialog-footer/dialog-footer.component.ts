import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The buttons of a `ui-dialog`, laid out at the end of a row that wraps:
 * `<div uiDialogFooter><button uiButton>Cancel</button>…</div>`.
 */
@Component({
  selector: '[uiDialogFooter]',
  template: '<ng-content />',
  styleUrl: './dialog-footer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DialogFooterComponent {}
