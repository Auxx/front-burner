import { MenuTrigger } from '@angular/aria/menu';
import { computed, Directive, inject } from '@angular/core';

import { TreeItemMenuDirective } from '../tree-item-menu/tree-item-menu.directive';

/**
 * The button that opens a `ui-menu`: `[uiMenuTrigger]="menu.aria"`, where
 * `menu` is the menu's `#menu="uiMenu"` reference. Click, Enter, Space and
 * ArrowDown open it on its first item, ArrowUp on its last.
 *
 * Several triggers can share one menu, such as the actions button of every
 * row of a tree: the menu opens next to, and returns the focus to, the trigger
 * that opened it.
 */
@Directive({
  selector: 'button[uiMenuTrigger]',
  hostDirectives: [ { directive: MenuTrigger, inputs: [ 'menu: uiMenuTrigger' ] } ],
  host: {
    type: 'button',
    // Aria writes `true`, which means the same; `menu` says it explicitly.
    '[attr.aria-haspopup]': '"menu"',
    // Our host bindings run after Aria's, so this one wins over Aria's own.
    '[attr.tabindex]': 'tabIndex()',
    '(click)': 'claimMenu()',
    '(keydown)': 'claimMenu()'
  }
})
export class MenuTriggerDirective {
  private readonly trigger = inject(MenuTrigger);
  private readonly inTreeRow = inject(TreeItemMenuDirective, { self: true, optional: true }) !== null;

  /**
   * Aria makes every trigger a tab stop; a tree row's actions button must not
   * be one (`uiTreeItemMenu`). `_pattern` is Aria's public but underscored
   * state: it has no other way to read the trigger's own tab index.
   */
  protected readonly tabIndex = computed(() => this.inTreeRow ? -1 : this.trigger._pattern.tabIndex());

  /**
   * Aria links a menu to the last trigger that was given it, and shows the menu
   * only while that trigger is expanded; so the trigger that is used takes it.
   */
  protected claimMenu(): void {
    this.trigger.menu()?.parent.set(this.trigger);
  }
}
