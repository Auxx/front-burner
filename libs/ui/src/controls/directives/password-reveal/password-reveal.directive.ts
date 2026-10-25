import { Directive, input, signal } from '@angular/core';

import { type InputComponent } from '../../components/input/input.component';

/**
 * Shows and hides the password in a `uiInput`, on a `uiIconButton` whose
 * label, such as "Show password", stays the same while `aria-pressed` carries
 * the state:
 *
 * ```html
 * <input uiInput #secret type="password" />
 * <button uiIconButton [uiPasswordReveal]="secret" label="Show password">…</button>
 * ```
 */
@Directive({
  selector: 'button[uiPasswordReveal]',
  host: {
    '[attr.aria-pressed]': 'revealed()',
    '[attr.aria-controls]': 'target().id()',
    '(click)': 'toggle()'
  }
})
export class PasswordRevealDirective {
  readonly target = input.required<InputComponent>({ alias: 'uiPasswordReveal' });

  protected readonly revealed = signal(false);

  protected toggle(): void {
    this.revealed.update(revealed => !revealed);
    this.target().element.type = this.revealed() ? 'text' : 'password';
  }
}
