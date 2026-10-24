import { Tab } from '@angular/aria/tabs';
import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A tab of a `ui-tab-strip`. `uiTab` is its value, which links it to the
 * `uiTabPanel` with the same value; its content is its label.
 */
@Component({
  selector: 'button[uiTab]',
  template: '<ng-content />',
  styleUrl: './tab.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [ { directive: Tab, inputs: [ 'value: uiTab', 'disabled' ] } ],
  host: {
    type: 'button'
  }
})
export class TabComponent {
}
