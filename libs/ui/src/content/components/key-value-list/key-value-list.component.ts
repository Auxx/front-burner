import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Read-only details as labelled values (RM-14, RM-16, RC-21): a `<dl>` whose
 * items are `div[uiKeyValue]`, the only grouping element HTML allows in it.
 * Values sit beside their labels, and under them when the list is narrow.
 */
@Component({
  selector: 'dl[uiKeyValueList]',
  template: '<ng-content />',
  styleUrl: './key-value-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class KeyValueListComponent {}
