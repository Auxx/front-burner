import { type Status } from '../../models/status.model';

/** A button on a toast, such as Push or Undo merge (GC-22). */
export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

/** A toast shown with `ToastService.show()`. */
export interface ToastOptions {
  readonly message: string;
  /** The accessible name of its dismiss button. */
  readonly dismissLabel: string;
  readonly status?: Status;
  /** At most 2. A toast with actions stays until it is dismissed or one runs. */
  readonly actions?: readonly ToastAction[];
  /** A toast with the same key as one on screen replaces it. */
  readonly key?: string;
}

/** A toast on screen. */
export interface ToastItem extends ToastOptions {
  readonly id: string;
}
