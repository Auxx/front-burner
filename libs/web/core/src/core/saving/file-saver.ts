import { HttpErrorResponse } from '@angular/common/http';
import { type Signal, signal } from '@angular/core';
import { type Observable, Subject } from 'rxjs';

import { toApiError } from '../errors/to-api-error';
import type { SaveResult, SaveStatus } from './save-status.model';

/** How long after the last edit a save is sent (A-8.9, ED-16). */
export const SAVE_DELAY_MS = 1500;

/** The `4xx` answers that are passing, retried as a save that did not reach the backend. */
const RETRIED_STATUSES = new Set([ 408, 429 ]);

/** The waits before each retry of a save that did not reach the backend; the last one repeats (NF-3.2). */
export const SAVE_RETRY_DELAYS_MS = [ 1000, 2000, 4000, 8000, 16_000, 30_000 ] as const;

export interface FileSaverOptions {
  /** Sends the content; it rejects with what the request threw. */
  send: (content: string) => Promise<SaveResult>;
  /** The content as it was loaded. */
  lastSaved: string;
  delayMs?: number;
  retryDelaysMs?: readonly number[];
}

/**
 * The save queue of one file (A-8.9, ED-16 to ED-19). It knows nothing about
 * files: it is given the function that sends the content.
 *
 * A save is sent {@link SAVE_DELAY_MS} after the last edit, one at a time;
 * while one is in flight, only the newest content waits behind it. Nothing is
 * sent when the content equals the last saved content. A save that does not
 * reach the backend, or that it answers with a `5xx`, `408` or `429`, is
 * retried with backoff, with the newest content; one it refuses with another
 * `4xx` is not retried until the next edit (ED-19). Nothing is sent while the
 * saver is held, such as while its file is renamed.
 */
export class FileSaver {
  private readonly send: (content: string) => Promise<SaveResult>;
  private readonly delayMs: number;
  private readonly retryDelaysMs: readonly number[];

  private readonly currentStatus = signal<SaveStatus>({ kind: 'saved' });
  private readonly dirty = signal(false);
  private readonly savedSubject = new Subject<SaveResult>();
  private readonly sendingSubject = new Subject<string>();
  private readonly upToDateSubject = new Subject<void>();

  /** The status of the open file's saves (ED-18). */
  readonly status: Signal<SaveStatus> = this.currentStatus.asReadonly();
  /** Whether there are edits the backend has not confirmed (NV-13). */
  readonly unsaved: Signal<boolean> = this.dirty.asReadonly();
  /** Each confirmed save, once `unsaved` tells whether newer content waits behind it. */
  readonly saved: Observable<SaveResult> = this.savedSubject.asObservable();
  /** The content of each save as it is sent, such as to keep it as a browser draft (ED-20). */
  readonly sending: Observable<string> = this.sendingSubject.asObservable();
  /**
   * Each time no edits are left unsaved: a save confirmed the newest content,
   * or the edits were undone back to the last saved content. Not on `discard`.
   */
  readonly upToDate: Observable<void> = this.upToDateSubject.asObservable();

  private last: { content: string | null; hash: string | null; };
  /** Reads the content waiting to be sent, read only when it is sent. */
  private pending: (() => string) | null = null;
  /** Whether the waiting content is to be sent as soon as no save is in flight. */
  private due = false;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  /** How many holders keep the saver from sending. */
  private holds = 0;
  /** Counts the discards, so that a save in flight when one happens is forgotten. */
  private generation = 0;

  constructor(options: FileSaverOptions) {
    this.send = options.send;
    this.delayMs = options.delayMs ?? SAVE_DELAY_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? SAVE_RETRY_DELAYS_MS;
    this.last = { content: options.lastSaved, hash: null };
  }

  /**
   * The content last confirmed by the backend, or loaded, and its hash once a
   * save confirmed it; the content is `null` when it is not known, after a
   * `rebase` without it.
   */
  lastSaved(): { content: string | null; hash: string | null; } {
    return this.last;
  }

  /**
   * Takes `content` and `hash` as what is on disk from now on, such as after
   * the file changed elsewhere (ED-24); without the content, the next edit is
   * sent whatever it holds. The waiting save, if any, stays.
   */
  rebase(content: string | null, hash: string | null): void {
    this.last = { content, hash };
  }

  /**
   * Resolves once no save is in flight, without sending a waiting one; `true`
   * when it waited for one.
   */
  async settled(): Promise<boolean> {
    let waited = false;
    while (this.inFlight !== null) {
      waited = true;
      await this.inFlight;
    }
    return waited;
  }

  /** The content waiting to be sent, read now, or `null` when none waits; not the content of a save in flight. */
  waiting(): string | null {
    return this.pending?.() ?? null;
  }

  /** Records an edit; `content` is read only when the save is sent. */
  edit(content: () => string): void {
    this.pending = content;
    this.dirty.set(true);
    if (this.retryTimer !== undefined) {
      // The retry sends the newest content.
      return;
    }
    this.currentStatus.set({ kind: 'saving' });
    this.due = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.due = true;
      this.next();
    }, this.delayMs);
  }

  /**
   * Sends a waiting save at once, also one waiting for a retry, and resolves
   * once nothing is waiting or in flight, or once the save failed and is left
   * to the retries.
   */
  async flush(): Promise<void> {
    if (this.pending !== null) {
      this.clearTimers();
      this.due = true;
      this.next();
    }
    while (this.inFlight !== null) {
      await this.inFlight;
    }
  }

  /**
   * Keeps the saver from sending until the returned function is called, such
   * as while its file is renamed (FB-36); a save that came due meanwhile is
   * sent then.
   */
  hold(): () => void {
    this.holds++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.holds--;
        this.next();
      }
    };
  }

  /**
   * Drops the waiting save and stops the retries, such as when the file is
   * deleted (FB-39); the answer to a save in flight is ignored.
   */
  discard(): void {
    this.generation++;
    this.clearTimers();
    this.pending = null;
    this.due = false;
    this.dirty.set(false);
    if (this.inFlight === null) {
      this.currentStatus.set({ kind: 'saved' });
    }
  }

  /** Sends the waiting content when it is due and no save is in flight. */
  private next(): void {
    if (this.inFlight !== null || this.holds > 0 || !this.due || this.pending === null) {
      return;
    }
    const content = this.pending();
    this.pending = null;
    this.due = false;
    if (content === this.last.content) {
      this.caughtUp();
      return;
    }
    const generation = this.generation;
    this.sendingSubject.next(content);
    this.inFlight = this.send(content).then(
      result => {
        if (generation === this.generation) {
          this.succeeded(content, result);
        }
      },
      (error: unknown) => {
        if (generation === this.generation) {
          this.failed(content, error);
        } else if (this.pending === null) {
          this.currentStatus.set({ kind: 'saved' });
        }
      }
    ).finally(() => {
      this.inFlight = null;
      this.next();
    });
  }

  private succeeded(content: string, result: SaveResult): void {
    this.last = { content, hash: result.hash };
    this.failures = 0;
    const newest = this.pending === null;
    if (newest) {
      this.dirty.set(false);
      this.currentStatus.set({ kind: 'saved' });
    }
    this.savedSubject.next(result);
    if (newest) {
      this.upToDateSubject.next();
    }
  }

  private caughtUp(): void {
    this.dirty.set(false);
    this.currentStatus.set({ kind: 'saved' });
    this.upToDateSubject.next();
  }

  private failed(content: string, error: unknown): void {
    if (
      error instanceof HttpErrorResponse && error.status >= 400 && error.status < 500
      && !RETRIED_STATUSES.has(error.status)
    ) {
      this.failures = 0;
      if (this.pending === null) {
        const apiError = toApiError(error);
        this.currentStatus.set({ kind: 'refused', code: apiError.code, error: apiError });
      }
      return;
    }
    // Typed meanwhile: the newest content is retried instead, after the backoff.
    this.pending ??= () => content;
    this.currentStatus.set({ kind: 'offline' });
    clearTimeout(this.timer);
    this.timer = undefined;
    this.due = false;
    const delay = this.retryDelaysMs[Math.min(this.failures, this.retryDelaysMs.length - 1)];
    this.failures++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.due = true;
      this.next();
    }, delay);
  }

  private clearTimers(): void {
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.timer = undefined;
    this.retryTimer = undefined;
  }
}
