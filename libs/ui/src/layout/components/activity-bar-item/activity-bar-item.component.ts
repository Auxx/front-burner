import { ToolbarWidget } from '@angular/aria/toolbar';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { ActivityBarComponent } from '../activity-bar/activity-bar.component';

/**
 * An item of the activity bar: a toggle button whose content is its icon.
 * `uiActivityBarItem` is its value, and `label` its accessible name.
 */
@Component({
  selector: 'button[uiActivityBarItem]',
  template: '<ng-content />',
  styleUrl: './activity-bar-item.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [ ToolbarWidget ],
  host: {
    type: 'button',
    '[attr.aria-label]': 'label()',
    '[attr.title]': 'label()',
    '[attr.aria-pressed]': 'pressed()',
    '(click)': 'activityBar.toggle(value())'
  }
})
export class ActivityBarItemComponent {
  readonly value = input.required<string>({ alias: 'uiActivityBarItem' });
  readonly label = input.required<string>();

  protected readonly activityBar = inject(ActivityBarComponent);
  protected readonly pressed = computed(() => this.activityBar.selected() === this.value());
}
