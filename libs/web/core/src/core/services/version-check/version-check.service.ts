import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable, InjectionToken, type Signal, signal } from '@angular/core';
// A type only: a value import of the contracts would bring Zod into the initial bundle (NF-2.9).
import type { VERSION_HEADER as ContractsVersionHeader } from '@front-burner/shared-contracts';

import { APP_VERSION } from '../../tokens/app-version';

/** The response header with the backend's version; typed by the contracts', so that the two cannot differ. */
export const VERSION_HEADER: typeof ContractsVersionHeader = 'X-Front-Burner-Version';

/** How long **Reload** waits for the pages' work before reloading anyway; the browser drafts are written by then. */
export const BEFORE_RELOAD_TIMEOUT_MS = 5_000;

/** How long after asking for the reload the page counts as having stayed. */
const STAYED_AFTER_MS = 1_000;

/** Reloads the page; a token, so that tests can watch it. */
export const PAGE_RELOAD = new InjectionToken<() => void>('PAGE_RELOAD', {
  providedIn: 'root',
  factory: () => {
    const document = inject(DOCUMENT);
    return () => document.location.reload();
  }
});

/** Work to finish before the page reloads for a new version, such as sending a waiting save (ED-17). */
export type BeforeReload = () => Promise<void>;

/**
 * The version check (A-8.7, NF-7.6): `newVersion` turns on once a response
 * carries a backend version other than the web client's own (`APP_VERSION`),
 * compared for equality only, and stays on until the page reloads. The
 * `versionCheckInterceptor` and the push channel report each response's
 * version.
 *
 * `reload` first runs what the pages registered with `beforeReload`, such as
 * the repository screen's waiting saves (NV-15), for up to
 * `BEFORE_RELOAD_TIMEOUT_MS`, then reloads, also when one of them failed: a
 * save that failed keeps its browser draft (NF-3). While it does, `reloading`
 * is on: a page whose unsaved work its hook has kept, such as the repository
 * screen, need not ask "Leave page?" on `beforeunload`; a page whose work
 * would be lost, such as the Add repository form, still asks. `reloading`
 * goes off again when the browser stays, such as when that question was
 * answered with Stay, so that **Reload** can be used again.
 */
@Injectable({ providedIn: 'root' })
export class VersionCheckService {
  private readonly appVersion = inject(APP_VERSION);
  private readonly reloadPage = inject(PAGE_RELOAD);
  private readonly hooks = new Set<BeforeReload>();
  private readonly changed = signal(false);
  private readonly inReload = signal(false);

  /** Whether the backend runs another version than this web client. */
  readonly newVersion: Signal<boolean> = this.changed.asReadonly();
  /** Whether **Reload** is under way: the page is about to go, and needs no "Leave page?" question. */
  readonly reloading: Signal<boolean> = this.inReload.asReadonly();

  /** Takes note of a response's version header; `null`, from a response without one, changes nothing. */
  seen(version: string | null): void {
    if (version !== null && version !== this.appVersion) {
      this.changed.set(true);
    }
  }

  /**
   * Runs `hook` before a reload for a new version, until the caller is
   * destroyed. Call it in an injection context, such as a constructor.
   */
  beforeReload(hook: BeforeReload): void {
    this.hooks.add(hook);
    inject(DestroyRef).onDestroy(() => this.hooks.delete(hook));
  }

  /**
   * Runs every `beforeReload` hook, for up to `BEFORE_RELOAD_TIMEOUT_MS`, then
   * reloads the page whatever they answered.
   */
  async reload(): Promise<void> {
    if (this.inReload()) {
      return;
    }
    this.inReload.set(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([ ...this.hooks ].map(hook => hook())),
        new Promise<void>(resolve => (timer = setTimeout(resolve, BEFORE_RELOAD_TIMEOUT_MS)))
      ]);
      this.reloadPage();
    } finally {
      clearTimeout(timer);
      // Still here after the reload had time to start: the browser stayed on
      // the page, such as when a "Leave page?" question was answered with Stay.
      // Not at once, as browsers may fire `beforeunload` after `reload()` returns.
      setTimeout(() => this.inReload.set(false), STAYED_AFTER_MS);
    }
  }
}
