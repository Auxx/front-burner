/** An option of a `ui-segmented-control` or a `ui-select`. */
export interface ChoiceOption<V> {
  /** Compared with `===`; use primitives. */
  readonly value: V;
  /** Visible text, accessible name and typeahead text. */
  readonly label: string;
  /** A second, muted line; shown by `ui-select` only. */
  readonly description?: string;
  readonly disabled?: boolean;
}
