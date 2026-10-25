import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  model,
  output
} from '@angular/core';

import { type ChoiceOption } from '../../models/choice-option.model';

let nextId = 0;

/**
 * A choice between a few options, shown side by side, built on native radio
 * buttons: the arrow keys move the choice, and the group is one tab stop.
 *
 * It has the shape of Signal Forms' `FormValueControl` (`value`, `disabled`,
 * `touch`), so it can be bound with `[formField]` as well as `[(value)]`.
 */
@Component({
  selector: 'ui-segmented-control',
  templateUrl: './segmented-control.component.html',
  styleUrl: './segmented-control.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'radiogroup',
    '[attr.aria-label]': 'label()',
    '[attr.aria-disabled]': 'disabled() || null',
    '(focusout)': 'onFocusOut($event)'
  }
})
export class SegmentedControlComponent<V> {
  readonly options = input.required<readonly ChoiceOption<V>[]>();
  readonly value = model<V | undefined>(undefined);
  readonly label = input.required<string>();
  readonly disabled = input(false, { transform: booleanAttribute });

  /** Emitted when the focus leaves the control. */
  readonly touch = output<void>();

  protected readonly name = `ui-segmented-${nextId++}`;

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected onFocusOut(event: FocusEvent): void {
    if (!(event.relatedTarget instanceof Node && this.element.contains(event.relatedTarget))) {
      this.touch.emit();
    }
  }
}
