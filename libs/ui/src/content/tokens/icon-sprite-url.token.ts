import { InjectionToken } from '@angular/core';

/**
 * The URL of the sprite that `ui-icon` draws from, `libs/ui/src/assets/icons.svg`
 * (A-10.35). Relative, so that it follows the document's base URL; the web
 * client serves the file at `assets/icons.svg`.
 */
export const ICON_SPRITE_URL = new InjectionToken<string>('ICON_SPRITE_URL', {
  providedIn: 'root',
  factory: () => 'assets/icons.svg'
});
