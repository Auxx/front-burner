import { booleanAttribute, ChangeDetectionStrategy, Component, ElementRef, inject, input } from '@angular/core';

import { SpinnerComponent } from '../../../feedback/components/spinner/spinner.component';
import { useBusyState } from '../../utils/busy/busy.util';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'default' | 'small';
export type ButtonType = 'button' | 'submit' | 'reset';

/**
 * A button, or a link that looks like one. Its content is its label, with an
 * optional leading `<svg>` icon.
 *
 * A button is `type="button"` unless `type` says otherwise, so that a button in
 * a form, such as Cancel, does not submit it. While `busy`, a spinner replaces
 * the icon and the button is `aria-disabled`; clicks on an `aria-disabled`
 * button are swallowed.
 */
@Component({
  selector: 'button[uiButton], a[uiButton]',
  imports: [ SpinnerComponent ],
  template: `
    <span class="icon" [hidden]="busy()"><ng-content select="svg" /></span>
    @if (busy()) {
      <ui-spinner />
    }
    <span class="label"><ng-content /></span>
  `,
  styleUrl: './button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.type]': 'isButton ? type() : null',
    '[attr.data-variant]': 'variant()',
    '[attr.data-size]': 'size()',
    '[attr.data-busy]': 'busy() || null'
  }
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('secondary');
  readonly size = input<ButtonSize>('default');
  readonly type = input<ButtonType>('button');
  readonly busy = input(false, { transform: booleanAttribute });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly isButton = this.host.tagName === 'BUTTON';

  constructor() {
    useBusyState(this.host, this.busy);
  }
}
