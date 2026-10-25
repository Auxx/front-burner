import { type Signal, signal } from '@angular/core';

/**
 * A control that a `ui-field` labels and describes. `Input`, `Textarea` and
 * `Select` provide themselves as one; a feature can build its own control on
 * it too.
 */
export abstract class FieldControl {
  /** The id of the element that gets the focus. */
  abstract readonly id: Signal<string>;

  /** Whether a `<label for>` labels it natively. */
  abstract readonly labelable: boolean;

  abstract focus(): void;

  /** Set by `ui-field`: the id of its label. */
  readonly labelledBy = signal<string | null>(null);

  /** Set by `ui-field`: the ids of its hint and error, if they are shown. */
  readonly describedBy = signal<string | null>(null);

  /** Set by `ui-field`: whether it shows an error. */
  readonly invalid = signal(false);
}
