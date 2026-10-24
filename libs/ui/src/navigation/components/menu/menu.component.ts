import { Menu } from '@angular/aria/menu';
import {
  createFlexibleConnectedPositionStrategy,
  createOverlayRef,
  createRepositionScrollStrategy,
  type OverlayRef
} from '@angular/cdk/overlay';
import { DomPortal } from '@angular/cdk/portal';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  untracked
} from '@angular/core';

/**
 * A pop-up menu of `uiMenuItem` actions and links, built on Angular Aria's
 * Menu: arrow keys between the items, Escape or a choice closes it and returns
 * the focus to its trigger, and it closes when the focus leaves it. While it is
 * open, it is moved into an overlay next to its trigger, so that no ancestor
 * clips it.
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
  hostDirectives: [ { directive: Menu, outputs: [ 'itemSelected' ] } ]
})
export class MenuComponent<V = unknown> {
  readonly aria = inject<Menu<V>>(Menu);

  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private overlayRef?: OverlayRef;

  constructor() {
    effect(() => {
      const visible = this.aria.visible();
      untracked(() => (visible ? this.attach() : this.detach()));
    });
    inject(DestroyRef).onDestroy(() => this.overlayRef?.dispose());
  }

  private attach(): void {
    const trigger = this.aria.parent()?.element;
    if (!trigger || this.overlayRef?.hasAttached()) {
      return;
    }

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
      this.overlayRef.updatePositionStrategy(positionStrategy);
    } else {
      this.overlayRef = createOverlayRef(this.injector, {
        positionStrategy,
        scrollStrategy: createRepositionScrollStrategy(this.injector)
      });
    }
    this.overlayRef.attach(new DomPortal(this.host));
  }

  private detach(): void {
    if (this.overlayRef?.hasAttached()) {
      this.overlayRef.detach();
    }
  }
}
