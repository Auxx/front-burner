import { ChangeDetectionStrategy, Component, contentChild, effect, input } from '@angular/core';

import { FieldControl } from '../../models/field-control.model';

let nextId = 0;

/**
 * A labelled form field around a control such as `uiInput`, `uiTextarea` or
 * `ui-select`, with an optional hint and error. It links them to the control
 * with `aria-labelledby` and `aria-describedby`, and marks the control
 * `aria-invalid` while it shows an error. When to show an error is the
 * feature's decision, for example once the field is touched (AR-6).
 *
 * Other content, such as a password reveal button, goes in the same row as the
 * control.
 */
@Component({
  selector: 'ui-field',
  templateUrl: './field.component.html',
  styleUrl: './field.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FieldComponent {
  readonly label = input.required<string>();
  readonly hint = input<string>();
  readonly error = input<string>();

  protected readonly control = contentChild.required(FieldControl, { descendants: true });

  private readonly id = `ui-field-${nextId++}`;
  protected readonly labelId = `${this.id}-label`;
  protected readonly hintId = `${this.id}-hint`;
  protected readonly errorId = `${this.id}-error`;

  constructor() {
    effect(() => {
      const control = this.control();
      const describedBy = [ this.hint() ? this.hintId : null, this.error() ? this.errorId : null ].filter(Boolean);

      control.labelledBy.set(this.labelId);
      control.describedBy.set(describedBy.length > 0 ? describedBy.join(' ') : null);
      control.invalid.set(!!this.error());
    });
  }

  /** A `<label for>` cannot label a control that is not a form element. */
  protected onLabelClick(): void {
    if (!this.control().labelable) {
      this.control().focus();
    }
  }
}
