import { booleanAttribute, ChangeDetectionStrategy, Component, ElementRef, inject, input } from '@angular/core';

import { SpinnerComponent } from '../../../feedback/components/spinner/spinner.component';
import { swallowClicksWhileAriaDisabled } from '../../utils/busy/busy.util';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'default' | 'small';
export type ButtonType = 'button' | 'submit' | 'reset';

/**
 * A button, or a link that looks like one. Its content is its label, with an
 * optional leading `<ui-icon>`.
 *
 * A button is `type="button"` unless `type` says otherwise, so that a button in
 * a form, such as Cancel, does not submit it. While `busy`, a spinner replaces
 * the icon. While `busy` or `unavailable`, the button is `aria-disabled`: it
 * keeps the focus, and its clicks are swallowed.
 */
@Component({
  selector: 'button[uiButton], a[uiButton]',
  imports: [ SpinnerComponent ],
  template: `
    <span class="icon" [hidden]="busy()"><ng-content select="ui-icon" /></span>
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
    '[attr.data-busy]': 'busy() || null',
    '[attr.aria-disabled]': 'busy() || unavailable() ? "true" : null'
  }
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('secondary');
  readonly size = input<ButtonSize>('default');
  readonly type = input<ButtonType>('button');
  readonly busy = input(false, { transform: booleanAttribute });
  /** Unavailable but focusable, to explain why with a tooltip (GA-8). Use instead of `aria-disabled`. */
  readonly unavailable = input(false, { transform: booleanAttribute });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly isButton = this.host.tagName === 'BUTTON';

  constructor() {
    swallowClicksWhileAriaDisabled(this.host);
  }
}
