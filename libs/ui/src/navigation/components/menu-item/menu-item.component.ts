import { MenuItem } from '@angular/aria/menu';
import { ChangeDetectionStrategy, Component, DestroyRef, inject } from '@angular/core';

/**
 * An item of a `ui-menu`: a button for an action or a link. `uiMenuItem` is its
 * value, which the menu's `(itemSelected)` emits; values are unique within a
 * menu. Its content is its label, with an optional leading `<ui-icon>`.
 *
 * Disable it with `[disabled]="true"`: Aria's input takes no attribute
 * transform, and a bare `disabled` attribute would also disable the native
 * button and take it out of the arrow-key order.
 *
 * Aria handles Enter and Space itself and prevents their default action, so a
 * link chosen from the keyboard is clicked here, once, when Aria selects it.
 */
@Component({
  selector: 'button[uiMenuItem], a[uiMenuItem]',
  template: '<ng-content select="ui-icon" /><span class="label"><ng-content /></span>',
  styleUrl: './menu-item.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [ { directive: MenuItem, inputs: [ 'value: uiMenuItem', 'disabled' ] } ],
  host: {
    '[attr.type]': 'type',
    '(click)': 'onClick($event)'
  }
})
export class MenuItemComponent<V> {
  private readonly item = inject<MenuItem<V>>(MenuItem);
  /** Its element, for the menu to tell which item has the focus. */
  readonly element: HTMLElement = this.item.element;

  protected readonly type = this.item.element.tagName === 'BUTTON' ? 'button' : null;

  /** The click being dispatched on this item, if any. */
  private click?: Event;

  /** Whether this item is clicking itself, after Aria selected it. */
  private following = false;

  constructor() {
    if (this.item.element.tagName === 'A' && this.item.parent) {
      const subscription = this.item.parent.itemSelected.subscribe(value => this.onSelected(value));
      inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
    }
  }

  protected onClick(event: Event): void {
    if (this.item.disabled()) {
      event.preventDefault();
    } else if (this.following) {
      // Aria has selected this item already; the click is only for the link.
      event.stopPropagation();
    } else {
      this.click = event;
    }
  }

  private onSelected(value: V | undefined): void {
    // A click selected it: the browser follows the link anyway.
    const clicked = this.click !== undefined && this.click.eventPhase !== Event.NONE;
    this.click = undefined;
    if (value !== this.item.value() || clicked) {
      return;
    }

    this.following = true;
    try {
      this.item.element.click();
    } finally {
      this.following = false;
    }
  }
}
