import { Directive, inject, TemplateRef } from '@angular/core';

import { type ChoiceOption } from '../../models/choice-option.model';

/** The context of a `uiSelectOption` template. */
export interface SelectOptionContext<V> {
  readonly $implicit: ChoiceOption<V>;
}

/**
 * The content of each option of a `ui-select`, in place of its label and
 * description, such as an SSH key's type and fingerprint (AR-24). The option's
 * label stays its accessible name.
 *
 * ```html
 * <ng-template uiSelectOption let-option>…</ng-template>
 * ```
 */
@Directive({
  selector: 'ng-template[uiSelectOption]'
})
export class SelectOptionDirective<V> {
  readonly template = inject<TemplateRef<SelectOptionContext<V>>>(TemplateRef);

  /** Types `let-option` in the template. */
  /* eslint-disable @typescript-eslint/no-unused-vars -- the signature is Angular's contract */
  static ngTemplateContextGuard<V>(
    _directive: SelectOptionDirective<V>,
    context: unknown
  ): context is SelectOptionContext<V> {
    return true;
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
