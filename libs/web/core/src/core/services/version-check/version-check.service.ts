import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable, InjectionToken, type Signal, signal } from '@angular/core';

import { APP_VERSION } from '../../tokens/app-version';

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
 * `versionCheckInterceptor` reports each response's version.
 *
 * `reload` first runs what the pages registered with `beforeReload`, such as
 * the repository screen's waiting saves (NV-15), then reloads, also when one
 * of them failed: a save that failed keeps its browser draft (NF-3).
 */
@Injectable({ providedIn: 'root' })
export class VersionCheckService {
  private readonly appVersion = inject(APP_VERSION);
  private readonly reloadPage = inject(PAGE_RELOAD);
  private readonly hooks = new Set<BeforeReload>();
  private readonly changed = signal(false);

  /** Whether the backend runs another version than this web client. */
  readonly newVersion: Signal<boolean> = this.changed.asReadonly();

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

  /** Runs every `beforeReload` hook, then reloads the page whatever they answered. */
  async reload(): Promise<void> {
    await Promise.allSettled([ ...this.hooks ].map(hook => hook()));
    this.reloadPage();
  }
}
