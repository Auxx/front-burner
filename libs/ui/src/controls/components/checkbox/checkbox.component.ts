import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A checkbox on a native `<input type="checkbox">`. Put it with its text in a
 * `label[uiChoice]`; a checkbox without visible text takes an `aria-label`.
 * Bind the mixed state with the native `[indeterminate]` property.
 */
@Component({
  selector: 'input[type=checkbox][uiCheckbox]',
  template: '',
  styleUrl: './checkbox.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CheckboxComponent {
}
