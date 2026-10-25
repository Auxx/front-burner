import { DestroyRef, effect, inject, Signal } from '@angular/core';

/**
 * Makes a button `aria-disabled` while `busy` is true, and swallows its clicks
 * whenever it is `aria-disabled`, whoever set it (A-10.46). Unlike `disabled`,
 * `aria-disabled` keeps the focus on the button and lets it show a tooltip.
 * Call in an injection context.
 */
export function useBusyState(host: HTMLElement, busy: Signal<boolean>): void {
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

  // Not a host binding: that would remove an `aria-disabled` the consumer set
  // whenever the button is not busy.
  let setByBusy = false;
  effect(() => {
    if (busy()) {
      setByBusy = setByBusy || host.getAttribute('aria-disabled') !== 'true';
      host.setAttribute('aria-disabled', 'true');
    } else if (setByBusy) {
      setByBusy = false;
      host.removeAttribute('aria-disabled');
    }
  });
}
