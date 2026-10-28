import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import { EmptyStateActionsComponent, EmptyStateComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * In place of the tree and the editor, for a repository that cannot be opened
 * (FB-3, DS-22): why, and a link to its settings, where the user can follow
 * the clone or fix the error.
 */
@Component({
  selector: 'rs-not-openable',
  imports: [ TranslocoDirective, RouterLink, EmptyStateComponent, EmptyStateActionsComponent ],
  templateUrl: './not-openable.component.html',
  styleUrl: './not-openable.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotOpenableComponent {
  readonly repository = input.required<RepositorySummary>();

  protected readonly reason = computed(() => {
    const { status, error } = this.repository();
    if (status === 'cloning') {
      return 'cloning';
    }
    if (status === 'needs-confirmation') {
      return 'needsConfirmation';
    }
    return error === 'working-copy-missing' ? 'workingCopyMissing' : 'cloneFailed';
  });
}
