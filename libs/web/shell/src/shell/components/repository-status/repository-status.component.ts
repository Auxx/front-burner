import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RepositoryStatus, RepositorySummary } from '@front-burner/shared-contracts';
import { BadgeComponent, type BadgeStatus } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/** How each status stands out; needing the user's action is highlighted (DS-21). */
const STATUS_BADGES: Record<RepositoryStatus, BadgeStatus> = {
  'needs-confirmation': 'info',
  cloning: 'neutral',
  ready: 'success',
  error: 'danger'
};

/**
 * A repository's status badge and one badge per warning (RM-6, RM-8),
 * wherever repositories are listed: the dashboard, the repository switcher
 * (NV-10) and the repository management page. `ready` has a badge only with
 * `showReady`, which the repository management page sets (RM-5). The badges
 * are laid out by the host's parent.
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
  /** Shows **Ready** for an openable repository too. */
  readonly showReady = input(false, { transform: booleanAttribute });

  protected readonly statusBadge = computed(() => {
    const status = this.repository().status;
    return status === 'ready' && !this.showReady() ? null : { status, look: STATUS_BADGES[status] };
  });
}
