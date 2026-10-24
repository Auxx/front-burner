import { Directive, input } from '@angular/core';

/** A labelled group of items in a `ui-menu`, such as the recent repositories. */
@Directive({
  selector: '[uiMenuGroup]',
  host: {
    role: 'group',
    '[attr.aria-label]': 'label()'
  }
})
export class MenuGroupDirective {
  readonly label = input.required<string>();
}
