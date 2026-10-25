import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The visible panel of a tooltip. Hidden from assistive technology: its host
 * is described by the same text through `aria-describedby`, or named by it.
 */
@Component({
  selector: 'ui-tooltip',
  template: '{{ text() }}',
  styleUrl: './tooltip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true'
  }
})
export class TooltipComponent {
  readonly text = input.required<string>();
}
