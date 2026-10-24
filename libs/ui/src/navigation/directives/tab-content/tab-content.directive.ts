import { TabContent } from '@angular/aria/tabs';
import { Directive } from '@angular/core';

/**
 * Marks the content of a `uiTabPanel`: `<ng-template uiTabContent>`. Aria
 * requires it. The content is created when its panel is first selected and kept
 * while the panel is hidden.
 */
@Directive({
  selector: 'ng-template[uiTabContent]',
  hostDirectives: [ TabContent ]
})
export class TabContentDirective {
}
