import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RepositoryStatus, RepositorySummary } from '@front-burner/shared-contracts';
import { BadgeComponent, type BadgeStatus } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/** How each status that is not `ready` stands out; needing the user's action is highlighted (DS-21). */
const STATUS_BADGES: Record<Exclude<RepositoryStatus, 'ready'>, BadgeStatus> = {
  'needs-confirmation': 'info',
  cloning: 'neutral',
  error: 'danger'
};

/**
 * A repository's status badge (none when `ready`) and one badge per warning
 * (RM-6, RM-8), wherever repositories are listed: the dashboard and the
 * repository switcher (NV-10). The badges are laid out by the host's parent.
 */
@Component({
  selector: 'shell-repository-status',
  imports: [ TranslocoDirective, BadgeComponent ],
  templateUrl: './repository-status.component.html',
  styleUrl: './repository-status.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositoryStatusComponent {
  readonly repository = input.required<RepositorySummary>();

  protected readonly statusBadge = computed(() => {
    const status = this.repository().status;
    return status === 'ready' ? null : { status, look: STATUS_BADGES[status] };
  });
}
