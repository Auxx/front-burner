import { type DialogRef as CdkDialogRef } from '@angular/cdk/dialog';
import { signal } from '@angular/core';
import { type Observable } from 'rxjs';

/** An open dialog: how its component closes it, and how its opener gets the result. */
export class DialogRef<R = unknown> {
  /**
   * Whether Escape and the close button close it. A dialog sets it to false
   * while its request runs, so that what the user typed is not lost (FB-45).
   * `close()` works either way.
   */
  readonly dismissible = signal(true);

  /** Emits the result once when it closes, `undefined` when it was dismissed, then completes. */
  readonly closed: Observable<R | undefined>;

  constructor(private readonly cdkRef: CdkDialogRef<R, unknown>) {
    this.closed = cdkRef.closed;
  }

  close(result?: R): void {
    this.cdkRef.close(result);
  }
}
