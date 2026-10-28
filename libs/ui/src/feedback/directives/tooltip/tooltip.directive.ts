import { booleanAttribute, Directive, ElementRef, inject, input } from '@angular/core';

import { attachTooltip } from '../../utils/tooltip/tooltip.util';

/**
 * Shows a tooltip on a focusable element and makes its text the element's
 * accessible description: `<button uiButton uiTooltip="Nothing to push">`.
 * It shows on hover, on keyboard focus and, for an `aria-disabled` element or
 * with `uiTooltipShowOnClick`, on click or tap (FB-20a, GA-8). `uiTooltipShown`
 * shows it for as long as it is true, such as on the keyboard's active row of
 * a tree, whose focus stays on the tree.
 */
@Directive({
  selector: '[uiTooltip]'
})
export class TooltipDirective {
  readonly text = input.required<string>({ alias: 'uiTooltip' });
  readonly showOnClick = input(false, { alias: 'uiTooltipShowOnClick', transform: booleanAttribute });
  readonly shown = input(false, { alias: 'uiTooltipShown' });

  constructor() {
    attachTooltip(inject<ElementRef<HTMLElement>>(ElementRef).nativeElement, this.text, {
      describes: true,
      showOnClick: this.showOnClick,
      shown: this.shown
    });
  }
}
