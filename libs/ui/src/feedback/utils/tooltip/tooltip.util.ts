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

export interface TooltipOptions {
  /** Whether `text` is the host's accessible description; false when it is already its name. */
  readonly describes: boolean;
  /** Whether a click or tap shows it; always so for an `aria-disabled` host. */
  readonly showOnClick: Signal<boolean>;
}

/**
 * Shows `text` next to `host` on hover (after a delay), on keyboard focus (at
 * once) and, when `showOnClick` or the host is aria-disabled, on click or tap
 * (A-10.45). The pointer can move onto the tooltip, and Escape hides it
 * without moving the focus (WCAG 1.4.13). Must be called in an injection
 * context; cleans up on destroy.
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
    if (target && host.contains(target)) {
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
    [ 'pointerleave', (event: PointerEvent) => !isTouch(event) && !shownByClick && !shownByFocus && scheduleHide() ],
    [ 'focusin', () => {
      if (focusVisible()) {
        show();
        shownByFocus = true;
      }
    } ],
    [ 'focusout', () => hide() ]
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

  inject(DestroyRef).onDestroy(() => {
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
