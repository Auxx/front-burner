import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { IconComponent } from '../../../content/components/icon/icon.component';
import { type IconName } from '../../../content/models/icon-name.model';
import { type Status } from '../../models/status.model';

const icons: Record<Status, IconName> = {
  info: 'info',
  success: 'pass',
  warning: 'warning',
  danger: 'error'
};

/** The icon of a status, coloured by it. Decorative: the text says the status. */
@Component({
  selector: 'ui-status-icon',
  imports: [ IconComponent ],
  template: `<ui-icon [name]="icon()" />`,
  styleUrl: './status-icon.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-status]': 'status()'
  }
})
export class StatusIconComponent {
  readonly status = input.required<Status>();

  protected readonly icon = computed(() => icons[this.status()]);
}
