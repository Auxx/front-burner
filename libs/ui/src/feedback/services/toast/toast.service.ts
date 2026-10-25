import { LiveAnnouncer } from '@angular/cdk/a11y';
import { inject, Injectable, signal } from '@angular/core';

import { type ToastAction, type ToastItem, type ToastOptions } from './toast.model';

/** How long a toast without actions stays on screen. */
export const TOAST_DURATION_MS = 6000;
/** How many toasts are shown at once; the oldest goes first. */
export const TOAST_LIMIT = 3;

let nextId = 0;

/**
 * Shows short notices of what the user just did, such as "Pushed 2 commits to
 * origin/main" (GA-32), in the `ui-toast-outlet` that the web client places
 * once (A-10.44). Each toast is announced, assertively for `danger`, and never
 * takes the focus.
 *
 * A toast without actions goes after `TOAST_DURATION_MS`, paused while it is
 * hovered or holds the focus; a toast with actions stays until it is dismissed
 * or an action runs (WCAG 2.2.1).
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly announcer = inject(LiveAnnouncer);
  private readonly items = signal<readonly ToastItem[]>([]);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  readonly toasts = this.items.asReadonly();

  show(options: ToastOptions): { dismiss(): void; } {
    const toast: ToastItem = { ...options, id: `ui-toast-${nextId++}` };
    const replaced = options.key === undefined ? undefined : this.items().find(item => item.key === options.key);

    if (replaced) {
      this.clearTimer(replaced.id);
      this.items.update(items => items.map(item => (item === replaced ? toast : item)));
    } else {
      const items = [ ...this.items(), toast ];
      for (const removed of items.splice(0, Math.max(0, items.length - TOAST_LIMIT))) {
        this.clearTimer(removed.id);
      }
      this.items.set(items);
    }

    this.startTimer(toast);
    void this.announcer.announce(toast.message, toast.status === 'danger' ? 'assertive' : 'polite');
    return { dismiss: () => this.dismiss(toast.id) };
  }

  dismiss(id: string): void {
    this.clearTimer(id);
    this.items.update(items => items.filter(item => item.id !== id));
  }

  /** Runs one of a toast's actions, which dismisses it. */
  run(id: string, action: ToastAction): void {
    this.dismiss(id);
    action.run();
  }

  /** Stops a toast's timer, while it is hovered or holds the focus. */
  pause(id: string): void {
    this.clearTimer(id);
  }

  /** Starts a toast's timer over. */
  resume(id: string): void {
    const toast = this.items().find(item => item.id === id);
    if (toast && !this.timers.has(id)) {
      this.startTimer(toast);
    }
  }

  private startTimer(toast: ToastItem): void {
    if (!toast.actions?.length) {
      this.timers.set(toast.id, setTimeout(() => this.dismiss(toast.id), TOAST_DURATION_MS));
    }
  }

  private clearTimer(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }
}
