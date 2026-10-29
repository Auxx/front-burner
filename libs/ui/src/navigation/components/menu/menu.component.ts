import { Menu, MenuTrigger } from '@angular/aria/menu';
import {
  createFlexibleConnectedPositionStrategy,
  createOverlayRef,
  createRepositionScrollStrategy,
  type OverlayRef
} from '@angular/cdk/overlay';
import { DomPortal } from '@angular/cdk/portal';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  contentChildren,
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  Injector,
  untracked
} from '@angular/core';

import { MenuItemComponent } from '../menu-item/menu-item.component';

/**
 * A pop-up menu of `uiMenuItem` actions and links, built on Angular Aria's
 * Menu: arrow keys between the items, Escape or a choice closes it and returns
 * the focus to its trigger, and it closes when the focus leaves it. While it is
 * open, it is moved into an overlay next to its trigger, so that no ancestor
 * clips it. Items may come and go while it is open, such as a list that loads:
 * until the user moves in it, the focus goes to the first item, and so it does
 * when the focused item goes.
 *
 * ```html
 * <button [uiMenuTrigger]="actions.aria">Git actions</button>
 * <ui-menu #actions="uiMenu" (itemSelected)="run($event)">
 *   <button uiMenuItem="fetch">Fetch</button>
 * </ui-menu>
 * ```
 *
 * `(itemSelected)` emits the value of the chosen item. `aria` is the handle
 * that a `uiMenuTrigger` takes: a host directive's input cannot be fed from an
 * input of ours, and Aria's trigger needs the `Menu` instance itself. It is the
 * one place where a feature touches an Aria type, and only as an opaque handle.
 */
@Component({
  selector: 'ui-menu',
  templateUrl: './menu.component.html',
  styleUrl: './menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  exportAs: 'uiMenu',
  hostDirectives: [ { directive: Menu, outputs: [ 'itemSelected' ] } ],
  host: {
    '(keydown)': 'moved = true'
  }
})
export class MenuComponent<V = unknown> {
  readonly aria = inject<Menu<V>>(Menu);

  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly items = contentChildren(MenuItemComponent, { descendants: true });
  /** Whether the user has moved in the menu since it opened. */
  protected moved = false;
  private overlayRef?: OverlayRef;
  /** The trigger that the overlay is positioned next to. */
  private origin?: HTMLElement;

  constructor() {
    // The parent is tracked too: a second trigger that claims the open menu
    // within one task (a touch tap fires focus and click together) turns
    // `visible` off and on again before this effect runs, so only the parent
    // shows that the menu has moved.
    effect(() => {
      const visible = this.aria.visible();
      const trigger = this.aria.parent()?.element;
      untracked(() => (visible ? this.attach(trigger) : this.detach()));
    });
    effect(() => {
      this.items();
      untracked(() => afterNextRender(() => this.keepFocus(), { injector: this.injector }));
    });
    inject(DestroyRef).onDestroy(() => {
      this.overlayRef?.dispose();
      // Disposing a DOM portal puts the host back where it was, even after
      // Angular removed its view; take it out of the page again.
      this.host.remove();
    });
  }

  /** After the items changed: the first one, unless the user has moved to one still there. */
  private keepFocus(): void {
    const trigger = this.aria.parent();
    const focused = this.document.activeElement;
    const first = this.items()[0];
    if (
      !this.aria.visible() || !(trigger instanceof MenuTrigger) || !first
      || (this.moved && this.host.contains(focused)) || focused === first.element
    ) {
      return;
    }
    trigger.open();
  }

  private attach(trigger: HTMLElement | undefined): void {
    if (!trigger || (this.overlayRef?.hasAttached() && trigger === this.origin)) {
      return;
    }
    this.moved = false;

    this.origin = trigger;
    const positionStrategy = createFlexibleConnectedPositionStrategy(this.injector, trigger)
      .withPositions([
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
        { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' },
        { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' },
        { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom' }
      ])
      .withPush(true)
      .withViewportMargin(8);

    if (this.overlayRef) {
      // Repositions at once when the menu is already shown.
      this.overlayRef.updatePositionStrategy(positionStrategy);
    } else {
      this.overlayRef = createOverlayRef(this.injector, {
        positionStrategy,
        scrollStrategy: createRepositionScrollStrategy(this.injector)
      });
    }
    if (!this.overlayRef.hasAttached()) {
      this.overlayRef.attach(new DomPortal(this.host));
    }
  }

  private detach(): void {
    if (this.overlayRef?.hasAttached()) {
      this.overlayRef.detach();
    }
  }
}
