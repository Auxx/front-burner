import { TabPanel, ɵɵDeferredContentAware as DeferredContentAware } from '@angular/aria/tabs';
import { Directive, inject } from '@angular/core';

/**
 * The panel of the tab with the same value. Its `<ng-template uiTabContent>`
 * is rendered when the panel is first selected, and then kept while the panel
 * is hidden, so that the panel keeps its state, such as the tree's expanded
 * folders.
 */
@Directive({
  selector: '[uiTabPanel]',
  hostDirectives: [ { directive: TabPanel, inputs: [ 'value: uiTabPanel' ] } ],
  host: {
    '[hidden]': '!panel.visible()'
  }
})
export class TabPanelDirective {
  protected readonly panel = inject(TabPanel);

  constructor() {
    inject(DeferredContentAware).preserveContent.set(true);
  }
}
