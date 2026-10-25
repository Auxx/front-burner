import { Directive, ElementRef, inject, input } from '@angular/core';

import { PopoverComponent } from '../../components/popover/popover.component';

/**
 * The button that opens and closes a `ui-popover`: `[uiPopoverTrigger]="info"`,
 * where `info` is the popover's `#info="uiPopover"` reference.
 */
@Directive({
  selector: 'button[uiPopoverTrigger]',
  host: {
    type: 'button',
    'aria-haspopup': 'dialog',
    '[attr.aria-expanded]': 'popover().open()',
    '[attr.aria-controls]': 'popover().id',
    '(click)': 'popover().toggle(host)'
  }
})
export class PopoverTriggerDirective {
  readonly popover = input.required<PopoverComponent>({ alias: 'uiPopoverTrigger' });

  protected readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
}
