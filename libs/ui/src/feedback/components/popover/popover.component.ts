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
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  model,
  untracked
} from '@angular/core';

let nextId = 0;

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), '
  + 'textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * A non-modal panel next to the button that opens it, such as the reason why
 * a background fetch failed with **Try again** (GA-35). The button is a
 * `button[uiPopoverTrigger]` that takes the popover's `#ref="uiPopover"`.
 *
 * Opening moves the focus inside it (to its first focusable element, or to the
 * panel itself). Escape closes it and returns the focus to the trigger; a
 * click or the focus going elsewhere closes it without moving the focus. Tab
 * out of either end closes it too and carries on from the trigger, as if the
 * popover sat right after it in the page (WCAG 2.4.3).
 * While it is open, it is moved into an overlay next to its trigger, so that
 * no ancestor clips it.
 */
@Component({
  selector: 'ui-popover',
  template: '<ng-content />',
  styleUrl: './popover.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  exportAs: 'uiPopover',
  host: {
    role: 'dialog',
    tabindex: '-1',
    '[id]': 'id',
    '[attr.aria-label]': 'label()',
    '[hidden]': '!open()',
    '(keydown.escape)': 'closeAndReturnFocus($event)',
    '(keydown.tab)': 'onTab($event)',
    '(keydown.shift.tab)': 'onTab($event)',
    '(focusout)': 'onFocusout($event)'
  }
})
export class PopoverComponent {
  readonly label = input.required<string>();
  readonly open = model(false);

  readonly id = `ui-popover-${nextId++}`;

  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private overlayRef?: OverlayRef;
  /** The trigger that opened it, which it is positioned next to. */
  private trigger?: HTMLElement;

  private readonly onDocumentPointerdown = (event: Event): void => {
    const target = event.target as Node;
    if (!this.host.contains(target) && !this.trigger?.contains(target)) {
      this.open.set(false);
    }
  };

  constructor() {
    effect(() => {
      const open = this.open();
      untracked(() => (open ? this.attach() : this.detach()));
    });
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('pointerdown', this.onDocumentPointerdown, true);
      this.overlayRef?.dispose();
      // Disposing a DOM portal puts the host back where it was, even after
      // Angular removed its view; take it out of the page again.
      this.host.remove();
    });
  }

  /** Opens or closes it from `trigger`. Called by `uiPopoverTrigger`. */
  toggle(trigger: HTMLElement): void {
    this.trigger = trigger;
    this.open.update(open => !open);
  }

  protected closeAndReturnFocus(event: Event): void {
    event.stopPropagation();
    this.open.set(false);
    this.trigger?.focus();
  }

  /**
   * The popover sits at the end of `<body>`, so the browser would move on to
   * the end of the page. Shift+Tab from its first element goes back to the
   * trigger; Tab from its last one focuses the trigger and lets the browser
   * move on from there.
   */
  protected onTab(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    const focusable = [ ...this.host.querySelectorAll<HTMLElement>(FOCUSABLE) ];
    const edge = keyboardEvent.shiftKey ? focusable[0] : focusable[focusable.length - 1];
    if (focusable.length && keyboardEvent.target !== edge) {
      return;
    }
    if (keyboardEvent.shiftKey) {
      keyboardEvent.preventDefault();
    }
    this.open.set(false);
    this.trigger?.focus();
  }

  protected onFocusout(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && !this.host.contains(next) && !this.trigger?.contains(next)) {
      this.open.set(false);
    }
  }

  private attach(): void {
    if (!this.trigger || this.overlayRef?.hasAttached()) {
      return;
    }
    this.overlayRef ??= createOverlayRef(this.injector, {
      positionStrategy: createFlexibleConnectedPositionStrategy(this.injector, this.trigger)
        .withPositions([
          { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
          { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
          { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
          { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 }
        ])
        .withPush(true)
        .withViewportMargin(8),
      scrollStrategy: createRepositionScrollStrategy(this.injector)
    });
    this.overlayRef.attach(new DomPortal(this.host));
    this.document.addEventListener('pointerdown', this.onDocumentPointerdown, true);

    // `hidden` comes off in this render; focus once it has.
    afterNextRender(
      () => {
        this.overlayRef?.updatePosition();
        (this.host.querySelector<HTMLElement>(FOCUSABLE) ?? this.host).focus();
      },
      { injector: this.injector }
    );
  }

  private detach(): void {
    this.document.removeEventListener('pointerdown', this.onDocumentPointerdown, true);
    if (this.overlayRef?.hasAttached()) {
      this.overlayRef.detach();
    }
  }
}
