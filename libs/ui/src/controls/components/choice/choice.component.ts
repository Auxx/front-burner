import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Lays out a `uiCheckbox` or `uiSwitch` and its text:
 *
 * ```html
 * <label uiChoice><input type="checkbox" uiCheckbox /> I understand</label>
 * ```
 */
@Component({
  selector: 'label[uiChoice]',
  template: '<ng-content />',
  styleUrl: './choice.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChoiceComponent {
}
