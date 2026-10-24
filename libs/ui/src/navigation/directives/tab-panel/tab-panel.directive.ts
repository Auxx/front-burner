import { TabPanel } from '@angular/aria/tabs';
import { Directive, inject } from '@angular/core';

/**
 * The panel of the tab with the same value. Its content is always rendered, so
 * a hidden panel keeps its state, such as the tree's expanded folders.
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
}
