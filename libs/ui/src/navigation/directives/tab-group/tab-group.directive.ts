import { Tabs } from '@angular/aria/tabs';
import { Directive } from '@angular/core';

/**
 * Marks the element that contains both a `ui-tab-strip` and its tab panels,
 * typically `<ui-island uiTabGroup>` with the strip in `uiIslandHeader`.
 */
@Directive({
  selector: '[uiTabGroup]',
  hostDirectives: [ Tabs ]
})
export class TabGroupDirective {
}
