import { HttpErrorResponse } from '@angular/common/http';
import { type Signal, signal } from '@angular/core';
import { type Observable, Subject } from 'rxjs';

import { toApiError } from '../errors/to-api-error';
import type { SaveResult, SaveStatus } from './save-status.model';

/** How long after the last edit a save is sent (A-8.9, ED-16). */
export const SAVE_DELAY_MS = 1500;

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
 * reach the backend, or that it answers with a `5xx`, is retried with
 * backoff, with the newest content; one it refuses with a `4xx` is not
 * retried until the next edit (ED-19).
 */
export class FileSaver {
  private readonly send: (content: string) => Promise<SaveResult>;
  private readonly delayMs: number;
  private readonly retryDelaysMs: readonly number[];

  private readonly currentStatus = signal<SaveStatus>({ kind: 'saved' });
  private readonly dirty = signal(false);
  private readonly savedSubject = new Subject<SaveResult>();

  /** The status of the open file's saves (ED-18). */
  readonly status: Signal<SaveStatus> = this.currentStatus.asReadonly();
  /** Whether there are edits the backend has not confirmed (NV-13). */
  readonly unsaved: Signal<boolean> = this.dirty.asReadonly();
  /** Each confirmed save. */
  readonly saved: Observable<SaveResult> = this.savedSubject.asObservable();

  private last: { content: string; hash: string | null; };
  /** Reads the content waiting to be sent, read only when it is sent. */
  private pending: (() => string) | null = null;
  /** Whether the waiting content is to be sent as soon as no save is in flight. */
  private due = false;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;

  constructor(options: FileSaverOptions) {
    this.send = options.send;
    this.delayMs = options.delayMs ?? SAVE_DELAY_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? SAVE_RETRY_DELAYS_MS;
    this.last = { content: options.lastSaved, hash: null };
  }

  /** The content last confirmed by the backend, or loaded, and its hash once a save confirmed it. */
  lastSaved(): { content: string; hash: string | null; } {
    return this.last;
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

  /** Drops the waiting save and stops the retries, such as when the file is deleted (FB-39). */
  discard(): void {
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
    if (this.inFlight !== null || !this.due || this.pending === null) {
      return;
    }
    const content = this.pending();
    this.pending = null;
    this.due = false;
    if (content === this.last.content) {
      this.dirty.set(false);
      this.currentStatus.set({ kind: 'saved' });
      return;
    }
    this.inFlight = this.send(content).then(
      result => this.succeeded(content, result),
      (error: unknown) => this.failed(content, error)
    ).finally(() => {
      this.inFlight = null;
      this.next();
    });
  }

  private succeeded(content: string, result: SaveResult): void {
    this.last = { content, hash: result.hash };
    this.failures = 0;
    this.savedSubject.next(result);
    if (this.pending === null) {
      this.dirty.set(false);
      this.currentStatus.set({ kind: 'saved' });
    }
  }

  private failed(content: string, error: unknown): void {
    if (error instanceof HttpErrorResponse && error.status >= 400 && error.status < 500) {
      this.failures = 0;
      if (this.pending === null) {
        this.currentStatus.set({ kind: 'refused', code: toApiError(error).code });
      }
      return;
    }
    // Typed meanwhile: the newest content is retried instead.
    this.pending ??= () => content;
    this.currentStatus.set({ kind: 'offline' });
    clearTimeout(this.timer);
    this.timer = undefined;
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
