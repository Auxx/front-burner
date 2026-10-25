import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A labelled value of a `dl[uiKeyValueList]`: `<div uiKeyValue label="Clone
 * mode">Single branch: main</div>`. The content is the value; `mono` sets it in
 * the code font, for fingerprints and other machine values.
 */
@Component({
  selector: 'div[uiKeyValue]',
  template: '<dt>{{ label() }}</dt><dd><ng-content /></dd>',
  styleUrl: './key-value.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-mono]': 'mono() || null'
  }
})
export class KeyValueComponent {
  readonly label = input.required<string>();
  readonly mono = input(false, { transform: booleanAttribute });
}
