import { ChangeDetectionStrategy, Component, ElementRef, inject, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'default' | 'small';
export type ButtonType = 'button' | 'submit' | 'reset';

/**
 * A button, or a link that looks like one. Its content is its label, with an
 * optional leading `<svg>` icon.
 *
 * A button is `type="button"` unless `type` says otherwise, so that a button in
 * a form, such as Cancel, does not submit it.
 */
@Component({
  selector: 'button[uiButton], a[uiButton]',
  template: '<ng-content select="svg" /><span class="label"><ng-content /></span>',
  styleUrl: './button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.type]': 'isButton ? type() : null',
    '[attr.data-variant]': 'variant()',
    '[attr.data-size]': 'size()'
  }
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('secondary');
  readonly size = input<ButtonSize>('default');
  readonly type = input<ButtonType>('button');

  protected readonly isButton = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement.tagName === 'BUTTON';
}
