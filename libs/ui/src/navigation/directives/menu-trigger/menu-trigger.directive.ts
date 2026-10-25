import { type Menu, MenuTrigger } from '@angular/aria/menu';
import { computed, DestroyRef, Directive, effect, inject, untracked } from '@angular/core';

import { TreeItemMenuDirective } from '../tree-item-menu/tree-item-menu.directive';

/** The trigger that last opened each shared menu. */
const owners = new WeakMap<Menu<unknown>, MenuTrigger<unknown>>();

const OPENING_KEYS = new Set([ 'Enter', ' ', 'ArrowDown', 'ArrowUp' ]);

/**
 * The button that opens a `ui-menu`: `[uiMenuTrigger]="menu.aria"`, where
 * `menu` is the menu's `#menu="uiMenu"` reference. Click, Enter, Space and
 * ArrowDown open it on its first item, ArrowUp on its last.
 *
 * Several triggers can share one menu, such as the actions button of every
 * row of a tree: the menu opens next to, and returns the focus to, the trigger
 * that opened it. Triggers created while it is open leave it alone, and it
 * closes when the trigger that opened it is destroyed.
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
    '(keydown)': 'onKeydown($event)'
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

  constructor() {
    // Aria links a menu to every new trigger it is given, and shows the menu
    // only while that trigger is expanded. A trigger created later, such as a
    // tree row scrolled into view, gives the menu back to the one that opened
    // it. This runs after Aria's own effect, which was created first.
    effect(() => {
      const menu = this.trigger.menu();
      untracked(() => {
        const owner = menu && owners.get(menu);
        if (menu && owner && owner !== this.trigger) {
          menu.parent.set(owner);
        }
      });
    });

    inject(DestroyRef).onDestroy(() => {
      const menu = this.trigger.menu();
      if (menu && owners.get(menu) === this.trigger) {
        this.trigger.close();
        owners.delete(menu);
      }
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (OPENING_KEYS.has(event.key)) {
      this.claimMenu();
    }
  }

  /** The trigger that opens the menu takes it, closing it for any other. */
  protected claimMenu(): void {
    const menu = this.trigger.menu();
    if (!menu) {
      return;
    }
    const owner = owners.get(menu);
    if (owner && owner !== this.trigger && owner.expanded()) {
      owner.close();
    }
    owners.set(menu, this.trigger);
    menu.parent.set(this.trigger);
  }
}
