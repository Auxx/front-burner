import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { type Status } from '../../models/status.model';

export type BadgeStatus = Status | 'neutral';

/**
 * A short label for a status, such as a repository's "Cloning" or "Clone
 * failed" (DS-22, RM-6), with an optional leading `<ui-icon>`. Its text says
 * the status; the colour only repeats it. Not interactive and not announced.
 */
@Component({
  selector: 'span[uiBadge]',
  template: '<ng-content select="ui-icon" /><ng-content />',
  styleUrl: './badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-status]': 'status()'
  }
})
export class BadgeComponent {
  readonly status = input<BadgeStatus>('neutral');
}
