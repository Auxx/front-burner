import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { type IconName } from '../../models/icon-name.model';
import { IconComponent } from '../icon/icon.component';

/**
 * Says why a place is empty and what to do next (FB-12, DS-11, GA-13): an
 * optional decorative icon, an optional heading at the level its place needs,
 * the message as content, and actions marked `uiEmptyStateActions`. It is not
 * announced. It centres itself in the block size it is given, such as the body
 * of a `ui-island` with `[scrollable]="false"`; content taller than that needs
 * a scrolling island instead.
 */
@Component({
  selector: 'ui-empty-state',
  imports: [ IconComponent ],
  templateUrl: './empty-state.component.html',
  styleUrl: './empty-state.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EmptyStateComponent {
  readonly icon = input<IconName>();
  readonly heading = input<string>();
  readonly headingLevel = input<2 | 3 | 4>(2);
}
