import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Shows that something is in progress. With a `label` it is an indeterminate
 * progress bar that assistive technology announces; without one it only
 * decorates, for example inside a busy button whose name already says what
 * runs.
 */
@Component({
  selector: 'ui-spinner',
  template: '',
  styleUrl: './spinner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.role]': 'label() ? "progressbar" : null',
    '[attr.aria-label]': 'label() || null',
    '[attr.aria-hidden]': 'label() ? null : "true"'
  }
})
export class SpinnerComponent {
  readonly label = input<string>();
}
