import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  forwardRef,
  inject,
  input
} from '@angular/core';

import { FieldControl } from '../../models/field-control.model';

let nextId = 0;

/**
 * A text field on a native `<input>`. Put it in a `ui-field` for its label,
 * hint and error. `code` sets it in the monospaced font.
 */
@Component({
  selector: 'input[uiInput]',
  template: '',
  styleUrl: './input.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ { provide: FieldControl, useExisting: forwardRef(() => InputComponent) } ],
  host: {
    '[id]': 'id()',
    '[attr.aria-labelledby]': 'labelledBy()',
    '[attr.aria-describedby]': 'describedBy()',
    '[attr.aria-invalid]': 'invalid() || null',
    '[attr.data-code]': 'code() || null'
  }
})
export class InputComponent extends FieldControl {
  readonly id = input<string>(`ui-input-${nextId++}`);
  readonly code = input(false, { transform: booleanAttribute });

  readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  readonly labelable = true;

  focus(): void {
    this.element.focus();
  }
}
