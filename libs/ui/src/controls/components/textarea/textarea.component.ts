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
 * A multi-line text field on a native `<textarea>`. Put it in a `ui-field` for its label,
 * hint and error. `code` sets it in the monospaced font.
 */
@Component({
  selector: 'textarea[uiTextarea]',
  template: '',
  styleUrl: './textarea.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ { provide: FieldControl, useExisting: forwardRef(() => TextareaComponent) } ],
  host: {
    '[id]': 'id()',
    '[attr.aria-labelledby]': 'labelledBy()',
    '[attr.aria-describedby]': 'describedBy()',
    '[attr.aria-invalid]': 'invalid() || null',
    '[attr.data-code]': 'code() || null'
  }
})
export class TextareaComponent extends FieldControl {
  readonly id = input<string>(`ui-textarea-${nextId++}`);
  readonly code = input(false, { transform: booleanAttribute });

  readonly element = inject<ElementRef<HTMLTextAreaElement>>(ElementRef).nativeElement;
  readonly labelable = true;

  focus(): void {
    this.element.focus();
  }
}
