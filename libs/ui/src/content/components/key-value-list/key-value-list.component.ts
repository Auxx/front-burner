import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Read-only details as labelled values (RM-14, RM-16, RC-21): a `<dl>` whose
 * items are `div[uiKeyValue]`, the only grouping element HTML allows in it.
 * Values sit beside their labels, and under them when the list is narrow.
 * The list takes its width from its container, never from its content (it is
 * a size container, A-10.7), so put it where a block gets a width: not in an
 * inline-block, a shrink-to-fit popover or a centred flex item.
 */
@Component({
  selector: 'dl[uiKeyValueList]',
  template: '<ng-content />',
  styleUrl: './key-value-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class KeyValueListComponent {}
