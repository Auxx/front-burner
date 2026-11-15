import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import { ButtonComponent } from '@front-burner/ui';
import { LastAccessedComponent, RepositoryStatusComponent } from '@front-burner/web-shell';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * One repository of the repository management page (RM-5): its name, which
 * opens its settings page, its status (**Ready** too) and warnings, its remote,
 * "Last accessed", and **Open** for an openable repository.
 */
@Component({
  selector: 'repo-repository-list-entry',
  imports: [ TranslocoDirective, RouterLink, ButtonComponent, RepositoryStatusComponent, LastAccessedComponent ],
  templateUrl: './repository-list-entry.component.html',
  styleUrl: './repository-list-entry.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositoryListEntryComponent {
  readonly repository = input.required<RepositorySummary>();

  protected readonly openable = computed(() => this.repository().status === 'ready');
}
