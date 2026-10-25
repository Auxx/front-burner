import { DestroyRef, inject } from '@angular/core';

/**
 * Swallows the clicks of a button while it is `aria-disabled`: busy or
 * unavailable (A-10.46). Unlike `disabled`, `aria-disabled` keeps the focus on
 * the button and lets it show a tooltip. Call in an injection context.
 */
export function swallowClicksWhileAriaDisabled(host: HTMLElement): void {
  // A capture listener on the target runs before the bubbling listeners that
  // templates add, so a consumer's `(click)` never sees the click.
  const swallow = (event: Event): void => {
    if (host.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  host.addEventListener('click', swallow, { capture: true });
  inject(DestroyRef).onDestroy(() => host.removeEventListener('click', swallow, { capture: true }));
}
