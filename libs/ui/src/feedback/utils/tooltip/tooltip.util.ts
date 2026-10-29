import {
  createFlexibleConnectedPositionStrategy,
  createOverlayRef,
  createRepositionScrollStrategy,
  type OverlayRef
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import {
  type ComponentRef,
  DestroyRef,
  DOCUMENT,
  effect,
  inject,
  Injector,
  type Signal,
  untracked
} from '@angular/core';

import { TooltipComponent } from '../../components/tooltip/tooltip.component';
import {
  type TooltipDescription,
  TooltipDescriptionsService
} from '../../services/tooltip-descriptions/tooltip-descriptions.service';

/** How long the pointer rests on a host before its tooltip shows. */
export const TOOLTIP_SHOW_DELAY_MS = 500;
/** How long a tooltip stays after the pointer leaves, to let it reach the tooltip. */
export const TOOLTIP_HIDE_DELAY_MS = 100;
/**
 * How long a finger rests on a host before its tooltip shows, as hover does for
 * a mouse. A platform whose own long press comes first shows it then.
 */
export const TOOLTIP_LONG_PRESS_MS = 500;
/** How long after a long press's finger lifts its click may still come, to be swallowed. */
export const TOOLTIP_LONG_PRESS_CLICK_MS = 300;

export interface TooltipOptions {
  /** Whether `text` is the host's accessible description; false when it is already its name. */
  readonly describes: boolean;
  /** Whether a click or tap shows it; always so for an `aria-disabled` host. */
  readonly showOnClick: Signal<boolean>;
  /** Shows it for as long as it is true, whatever the pointer and the focus do. */
  readonly shown?: Signal<boolean>;
  /**
   * Whether a long press shows it, and the click that ends the press is not
   * the host's (NV-11). Only for hosts whose tap does something else, such as
   * opening a menu, and that have no other way to show it by touch.
   */
  readonly longPress?: Signal<boolean>;
}

/**
 * Shows `text` next to `host` on hover (after a delay), on keyboard focus (at
 * once), when `longPress` on a long press, and, when `showOnClick` or the host
 * is aria-disabled, on click or tap (A-10.45). The pointer can move onto the
 * tooltip, and Escape hides it without moving the focus (WCAG 1.4.13). Must
 * be called in an injection context; cleans up on destroy.
 */
export function attachTooltip(host: HTMLElement, text: Signal<string>, options: TooltipOptions): void {
  const injector = inject(Injector);
  const document = inject(DOCUMENT);
  const descriptions = inject(TooltipDescriptionsService);

  let overlayRef: OverlayRef | undefined;
  let panel: ComponentRef<TooltipComponent> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shownByClick = false;
  let shownByFocus = false;
  let shownByInput = false;
  let longPress: ReturnType<typeof setTimeout> | undefined;
  /** Whether a finger is on the host and may become a long press. */
  let pressing = false;
  /** Whether a long press just showed the tooltip, so the click that ends it is not the host's. */
  let pressedLong = false;
  let pressedLongEnd: ReturnType<typeof setTimeout> | undefined;
  let description: TooltipDescription | undefined;

  const show = (): void => {
    clearTimeout(timer);
    if (!text() || panel) {
      return;
    }
    overlayRef ??= createOverlayRef(injector, {
      positionStrategy: createFlexibleConnectedPositionStrategy(injector, host)
        .withPositions([
          { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -4 },
          { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 4 },
          // Near an edge of the screen, aligned with the host's edge instead.
          { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
          { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
          { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
          { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
          { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 4 },
          { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -4 }
        ])
        .withPush(true)
        .withViewportMargin(8),
      scrollStrategy: createRepositionScrollStrategy(injector)
    });
    panel = overlayRef.attach(new ComponentPortal(TooltipComponent, null, injector));
    panel.setInput('text', text());
    panel.changeDetectorRef.detectChanges();
    // Attaching positioned the panel while it was still empty.
    overlayRef.updatePosition();

    const element = panel.location.nativeElement as HTMLElement;
    element.addEventListener('pointerenter', () => clearTimeout(timer));
    element.addEventListener('pointerleave', () => scheduleHide());
    document.addEventListener('keydown', onKeydown, true);
  };

  const hide = (): void => {
    clearTimeout(timer);
    shownByClick = false;
    shownByFocus = false;
    shownByInput = false;
    if (panel) {
      overlayRef?.detach();
      panel = undefined;
      document.removeEventListener('keydown', onKeydown, true);
    }
  };

  const scheduleShow = (): void => {
    clearTimeout(timer);
    timer = setTimeout(show, TOOLTIP_SHOW_DELAY_MS);
  };

  const scheduleHide = (): void => {
    clearTimeout(timer);
    timer = setTimeout(hide, TOOLTIP_HIDE_DELAY_MS);
  };

  const isTouch = (event: Event): boolean => (event as PointerEvent).pointerType === 'touch';

  /** Forgets the current or last long press. */
  const endPress = (): void => {
    pressing = false;
    pressedLong = false;
    clearTimeout(longPress);
    clearTimeout(pressedLongEnd);
  };

  const pressedLongEnough = (): void => {
    // With nothing to show, the press stays an ordinary tap.
    if (!text()) {
      return;
    }
    pressedLong = true;
    show();
    // Until a click elsewhere, as for a tap.
    shownByClick = true;
  };

  const focusVisible = (): boolean => {
    try {
      return host.matches(':focus-visible');
    } catch {
      return true;
    }
  };

  // Only while shown, so that Escape reaches dialogs and menus otherwise.
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      hide();
    }
  }

  // At the document, in the capture phase: an aria-disabled button swallows
  // its own clicks before any listener on it runs (A-10.46).
  const onDocumentClick = (event: MouseEvent): void => {
    const target = event.target as Node | null;
    if (target && host.contains(target) && pressedLong) {
      pressedLong = false;
      event.preventDefault();
      event.stopPropagation();
    } else if (target && host.contains(target)) {
      if (options.showOnClick() || host.getAttribute('aria-disabled') === 'true') {
        if (shownByClick) {
          hide();
        } else {
          show();
          shownByClick = true;
        }
      }
    } else if (shownByClick && !(target && panel?.location.nativeElement.contains(target))) {
      hide();
    }
  };

  const listeners: [ string, (event: never) => void ][] = [
    [ 'pointerenter', (event: PointerEvent) => !isTouch(event) && (panel ? clearTimeout(timer) : scheduleShow()) ],
    [
      'pointerleave',
      (event: PointerEvent) => !isTouch(event) && !shownByClick && !shownByFocus && !shownByInput && scheduleHide()
    ],
    [ 'focusin', () => {
      if (focusVisible()) {
        show();
        shownByFocus = true;
      }
    } ],
    [ 'focusout', () => hide() ],
    [ 'pointerdown', (event: PointerEvent) => {
      endPress();
      if (options.longPress?.() && isTouch(event)) {
        pressing = true;
        longPress = setTimeout(pressedLongEnough, TOOLTIP_LONG_PRESS_MS);
      }
    } ],
    [ 'pointerup', () => {
      pressing = false;
      clearTimeout(longPress);
      // The click comes right after the finger lifts, or never, such as when
      // the finger slid off the host: a later click is the host's again.
      if (pressedLong) {
        pressedLongEnd = setTimeout(() => (pressedLong = false), TOOLTIP_LONG_PRESS_CLICK_MS);
      }
    } ],
    [ 'pointercancel', () => endPress() ],
    // The platform's own long press, which can come before ours: it shows the
    // tooltip instead of a context menu.
    [ 'contextmenu', (event: MouseEvent) => {
      if (pressing || pressedLong) {
        event.preventDefault();
      }
      if (pressing && !pressedLong) {
        clearTimeout(longPress);
        pressedLongEnough();
      }
    } ]
  ];
  for (const [ type, listener ] of listeners) {
    host.addEventListener(type, listener as EventListener);
  }
  document.addEventListener('click', onDocumentClick, true);

  effect(() => {
    const value = text();
    untracked(() => {
      if (panel) {
        panel.setInput('text', value);
        panel.changeDetectorRef.detectChanges();
        overlayRef?.updatePosition();
      }
      if (!value) {
        hide();
      }
      if (options.describes) {
        describe(value);
      }
    });
  });

  function describe(value: string): void {
    if (value && description) {
      description.update(value);
    } else if (value) {
      description = descriptions.add(value);
      setDescribedBy(host, description.id, true);
    } else if (description) {
      setDescribedBy(host, description.id, false);
      description.remove();
      description = undefined;
    }
  }

  effect(() => {
    const shown = options.shown?.() ?? false;
    untracked(() => {
      if (shown) {
        show();
        shownByInput = true;
      } else if (shownByInput) {
        hide();
      }
    });
  });

  inject(DestroyRef).onDestroy(() => {
    endPress();
    hide();
    overlayRef?.dispose();
    for (const [ type, listener ] of listeners) {
      host.removeEventListener(type, listener as EventListener);
    }
    document.removeEventListener('click', onDocumentClick, true);
    describe('');
  });
}

/** Adds or removes one id in `aria-describedby`, keeping the others. */
function setDescribedBy(host: HTMLElement, id: string, present: boolean): void {
  const ids = (host.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(token => token && token !== id);
  if (present) {
    ids.push(id);
  }
  if (ids.length) {
    host.setAttribute('aria-describedby', ids.join(' '));
  } else {
    host.removeAttribute('aria-describedby');
  }
}
