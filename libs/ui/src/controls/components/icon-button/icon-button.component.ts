import { booleanAttribute, ChangeDetectionStrategy, Component, ElementRef, inject, input } from '@angular/core';

import { SpinnerComponent } from '../../../feedback/components/spinner/spinner.component';
import { useBusyState } from '../../utils/busy/busy.util';
import { type ButtonSize, type ButtonType } from '../button/button.component';

/**
 * A button whose content is one `<svg>` icon. `label` is its accessible name
 * and its tooltip. Set `pressed` to make it a toggle button. While `busy`, a
 * spinner replaces the icon and the button is `aria-disabled`.
 */
@Component({
  selector: 'button[uiIconButton]',
  imports: [ SpinnerComponent ],
  template: `
    <span class="icon" [hidden]="busy()"><ng-content /></span>
    @if (busy()) {
      <ui-spinner />
    }
  `,
  styleUrl: './icon-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.type]': 'type()',
    '[attr.aria-label]': 'label()',
    '[attr.title]': 'label()',
    '[attr.aria-pressed]': 'pressed() ?? null',
    '[attr.data-variant]': 'variant()',
    '[attr.data-size]': 'size()',
    '[attr.data-busy]': 'busy() || null'
  }
})
export class IconButtonComponent {
  readonly label = input.required<string>();
  readonly variant = input<'ghost' | 'secondary'>('ghost');
  readonly size = input<ButtonSize>('default');
  readonly type = input<ButtonType>('button');
  readonly pressed = input<boolean | undefined>(undefined);
  readonly busy = input(false, { transform: booleanAttribute });

  constructor() {
    useBusyState(inject<ElementRef<HTMLElement>>(ElementRef).nativeElement, this.busy);
  }
}
