import { isRefusal } from '@front-burner/web-core';
import { finalize, type Observable, type Subscription } from 'rxjs';

/** What to do with the answer of a read. */
export interface LatestReadHandlers<T> {
  readonly next: (value: T) => void;
  /** Also called for each failed try. */
  readonly error: (error: unknown) => void;
}

/**
 * One read at a time of something that an idle repository sends no event about:
 * a new read cancels the one still running, and a read that fails is tried again
 * after a wait, unless it was refused, as the same request would be refused again.
 */
export class LatestRead {
  private request: Subscription | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly retryMs: number;

  constructor(retryMs: number) {
    this.retryMs = retryMs;
  }

  /** Reads what `start` answers. Settles when this try has ended, also when it was cancelled. */
  run<T>(start: () => Observable<T>, handlers: LatestReadHandlers<T>): Promise<void> {
    this.cancel();
    return new Promise(resolve => {
      this.request = start().pipe(finalize(resolve)).subscribe({
        next: handlers.next,
        error: error => {
          handlers.error(error);
          if (!isRefusal(error)) {
            this.retryTimer = setTimeout(() => void this.run(start, handlers), this.retryMs);
          }
        }
      });
    });
  }

  /** Stops the running read, and the wait to try one again. */
  cancel(): void {
    clearTimeout(this.retryTimer);
    this.request?.unsubscribe();
  }
}
