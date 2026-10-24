import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The bar at the bottom of the screen (A-10.5), for the save state, sync state
 * and branch. Content goes at the start; content marked `uiStatusBarEnd` at the
 * end. Long start content is shortened with an ellipsis, so that the page never
 * scrolls sideways (NF-12.4).
 */
@Component({
  selector: 'ui-status-bar',
  templateUrl: './status-bar.component.html',
  styleUrl: './status-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'group',
    '[attr.aria-label]': 'label()'
  }
})
export class StatusBarComponent {
  readonly label = input.required<string>();
}
