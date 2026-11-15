import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import { ProgressBarComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * The line under a listed repository that says more about its status,
 * wherever repositories are listed: what went wrong for one in error (DS-22,
 * RM-6), and for a cloning one "Waiting for other clones to finish" or the
 * clone's progress (RM-7, DS-23, AR-52). Nothing for the other statuses.
 */
@Component({
  selector: 'shell-repository-status-detail',
  imports: [ TranslocoDirective, ProgressBarComponent ],
  templateUrl: './repository-status-detail.component.html',
  styleUrl: './repository-status-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.none]': 'detail() === null' }
})
export class RepositoryStatusDetailComponent {
  readonly repository = input.required<RepositorySummary>();

  /** What the line shows; a cloning repository without a known job shows an indeterminate bar. */
  protected readonly detail = computed(() => {
    const repository = this.repository();
    if (repository.status === 'error' && repository.error !== null) {
      return { kind: 'error', error: repository.error } as const;
    }
    if (repository.status !== 'cloning') {
      return null;
    }
    if (repository.clone?.state === 'waiting') {
      return { kind: 'waiting' } as const;
    }
    return { kind: 'progress', percent: repository.clone?.percent ?? null } as const;
  });
}
