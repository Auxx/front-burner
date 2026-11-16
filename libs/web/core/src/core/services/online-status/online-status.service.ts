import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable, type Signal, signal } from '@angular/core';

/**
 * Whether the browser is online, following its `online` and `offline` events,
 * for the offline banner (NV-15). The browser only knows whether there is a
 * network, not whether the backend answers.
 */
@Injectable({ providedIn: 'root' })
export class OnlineStatusService {
  private readonly state = signal(true);

  readonly online: Signal<boolean> = this.state.asReadonly();

  constructor() {
    const window = inject(DOCUMENT).defaultView;
    if (!window) {
      return;
    }
    this.state.set(window.navigator.onLine);
    const online = () => this.state.set(true);
    const offline = () => this.state.set(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    });
  }
}
