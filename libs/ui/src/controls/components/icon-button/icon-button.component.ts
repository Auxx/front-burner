import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { type ButtonSize, type ButtonType } from '../button/button.component';

/**
 * A button whose content is one `<svg>` icon. `label` is its accessible name
 * and its tooltip. Set `pressed` to make it a toggle button.
 */
@Component({
  selector: 'button[uiIconButton]',
  template: '<ng-content />',
  styleUrl: './icon-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.type]': 'type()',
    '[attr.aria-label]': 'label()',
    '[attr.title]': 'label()',
    '[attr.aria-pressed]': 'pressed() ?? null',
    '[attr.data-variant]': 'variant()',
    '[attr.data-size]': 'size()'
  }
})
export class IconButtonComponent {
  readonly label = input.required<string>();
  readonly variant = input<'ghost' | 'secondary'>('ghost');
  readonly size = input<ButtonSize>('default');
  readonly type = input<ButtonType>('button');
  readonly pressed = input<boolean | undefined>(undefined);
}
