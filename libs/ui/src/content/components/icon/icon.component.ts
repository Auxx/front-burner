import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { type IconName } from '../../models/icon-name.model';
import { ICON_SPRITE_URL } from '../../tokens/icon-sprite-url.token';

/**
 * A Codicon from the sprite (A-10.35), drawn in the current text colour at
 * `--ui-icon-size`; a parent resizes it by setting that token on it. It is
 * decorative unless it has a `label`, and then an image with that name. An
 * icon-only button takes its name on the button, not on the icon.
 */
@Component({
  selector: 'ui-icon',
  template: `
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><use [attr.href]="href()" /></svg>
  `,
  styleUrl: './icon.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.role]': 'label() ? "img" : null',
    '[attr.aria-label]': 'label() || null',
    '[attr.aria-hidden]': 'label() ? null : "true"'
  }
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly label = input<string>();

  private readonly spriteUrl = inject(ICON_SPRITE_URL);

  protected readonly href = computed(() => `${this.spriteUrl}#${this.name()}`);
}
