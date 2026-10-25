import { LiveAnnouncer } from '@angular/cdk/a11y';
import { inject, Injectable, signal } from '@angular/core';

import { type ToastAction, type ToastItem, type ToastOptions } from './toast.model';

/** How long a toast without actions stays on screen. */
export const TOAST_DURATION_MS = 6000;
/** How many toasts are shown at once. */
export const TOAST_LIMIT = 3;

/** What keeps a toast's timer from running. */
export type ToastHold = 'hover' | 'focus';

let nextId = 0;

/**
 * Shows short notices of what the user just did, such as "Pushed 2 commits to
 * origin/main" (GA-32), in the `ui-toast-outlet` that the web client places
 * once (A-10.44). Each toast is announced, assertively for `danger`, and never
 * takes the focus.
 *
 * A toast without actions goes after `TOAST_DURATION_MS`, paused while it is
 * hovered or holds the focus; a toast with actions stays until it is dismissed
 * or an action runs (WCAG 2.2.1). Over `TOAST_LIMIT`, the oldest toast that
 * has no actions and is not held goes first; when every toast must stay, a new
 * one waits for a free place.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly announcer = inject(LiveAnnouncer);
  private readonly items = signal<readonly ToastItem[]>([]);
  private readonly queue: ToastItem[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly holds = new Map<string, Set<ToastHold>>();

  readonly toasts = this.items.asReadonly();

  show(options: ToastOptions): { dismiss(): void; } {
    const replaced = options.key === undefined
      ? undefined
      : [ ...this.items(), ...this.queue ].find(item => item.key === options.key);

    // A replacement keeps its place, its id and its holds, so that the focus
    // and the pointer stay on it.
    const toast: ToastItem = { ...options, id: replaced?.id ?? `ui-toast-${nextId++}` };

    if (replaced && this.queue.includes(replaced)) {
      this.queue.splice(this.queue.indexOf(replaced), 1, toast);
    } else if (replaced) {
      this.items.update(items => items.map(item => (item === replaced ? toast : item)));
      this.restartTimer(toast);
      this.announce(toast);
    } else {
      this.queue.push(toast);
      this.showQueued();
    }

    return { dismiss: () => this.dismiss(toast.id) };
  }

  dismiss(id: string): void {
    this.clearTimer(id);
    this.holds.delete(id);
    const queued = this.queue.findIndex(item => item.id === id);
    if (queued >= 0) {
      this.queue.splice(queued, 1);
    }
    this.items.update(items => items.filter(item => item.id !== id));
    this.showQueued();
  }

  /** Runs one of a toast's actions, which dismisses it. */
  run(id: string, action: ToastAction): void {
    this.dismiss(id);
    action.run();
  }

  /** Stops a toast's timer while it is hovered or holds the focus. */
  pause(id: string, hold: ToastHold): void {
    const holds = this.holds.get(id) ?? new Set<ToastHold>();
    holds.add(hold);
    this.holds.set(id, holds);
    this.clearTimer(id);
  }

  /** Starts a toast's timer over once nothing holds it. */
  resume(id: string, hold: ToastHold): void {
    const holds = this.holds.get(id);
    holds?.delete(hold);
    const toast = this.items().find(item => item.id === id);
    if (toast && !holds?.size) {
      this.holds.delete(id);
      this.restartTimer(toast);
    }
  }

  /** Moves queued toasts on screen while there is a place, or a toast that may go. */
  private showQueued(): void {
    while (this.queue.length) {
      const items = [ ...this.items() ];
      if (items.length >= TOAST_LIMIT) {
        const evictable = items.find(item => !item.actions?.length && !this.holds.get(item.id)?.size);
        if (!evictable) {
          return;
        }
        this.clearTimer(evictable.id);
        items.splice(items.indexOf(evictable), 1);
      }
      const toast = this.queue.shift() as ToastItem;
      this.items.set([ ...items, toast ]);
      this.restartTimer(toast);
      this.announce(toast);
    }
  }

  private announce(toast: ToastItem): void {
    void this.announcer.announce(toast.message, toast.status === 'danger' ? 'assertive' : 'polite');
  }

  private restartTimer(toast: ToastItem): void {
    this.clearTimer(toast.id);
    if (!toast.actions?.length && !this.holds.get(toast.id)?.size) {
      this.timers.set(toast.id, setTimeout(() => this.dismiss(toast.id), TOAST_DURATION_MS));
    }
  }

  private clearTimer(id: string): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }
}
