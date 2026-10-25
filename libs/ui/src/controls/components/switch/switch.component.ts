import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A switch on a native `<input type="checkbox">`, for a setting that applies
 * at once. Put it with its text in a `label[uiChoice]`.
 */
@Component({
  selector: 'input[type=checkbox][uiSwitch]',
  template: '',
  styleUrl: './switch.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'switch'
  }
})
export class SwitchComponent {
}
