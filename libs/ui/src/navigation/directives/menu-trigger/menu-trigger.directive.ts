import { MenuTrigger } from '@angular/aria/menu';
import { Directive } from '@angular/core';

/**
 * The button that opens a `ui-menu`: `[uiMenuTrigger]="menu.aria"`, where
 * `menu` is the menu's `#menu="uiMenu"` reference. Click, Enter, Space and
 * ArrowDown open it on its first item, ArrowUp on its last.
 */
@Directive({
  selector: 'button[uiMenuTrigger]',
  hostDirectives: [ { directive: MenuTrigger, inputs: [ 'menu: uiMenuTrigger' ] } ],
  host: {
    type: 'button',
    // Aria writes `true`, which means the same; `menu` says it explicitly.
    '[attr.aria-haspopup]': '"menu"'
  }
})
export class MenuTriggerDirective {
}
