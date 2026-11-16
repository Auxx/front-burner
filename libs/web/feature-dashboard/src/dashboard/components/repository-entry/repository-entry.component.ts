import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import {
  LastAccessedComponent,
  RepositoryStatusComponent,
  RepositoryStatusDetailComponent
} from '@front-burner/web-shell';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * One repository of the recent list (DS-18 to DS-22). Only a ready repository
 * links to the editor; a cloning or failed one links to its settings instead.
 * A ready repository with warnings stays openable and also links to its
 * settings, where each warning has its fix (RM-8; plan 120's call: no dialog
 * opens from a list).
 * The confirmation flow (DS-21) is not built yet, so a repository that needs
 * confirmation links nowhere.
 */
@Component({
  selector: 'dash-repository-entry',
  imports: [
    TranslocoDirective,
    RouterLink,
    RepositoryStatusComponent,
    RepositoryStatusDetailComponent,
    LastAccessedComponent
  ],
  templateUrl: './repository-entry.component.html',
  styleUrl: './repository-entry.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositoryEntryComponent {
  readonly repository = input.required<RepositorySummary>();

  protected readonly openable = computed(() => this.repository().status === 'ready');
  protected readonly hasSettingsLink = computed(() => {
    const { status, warnings } = this.repository();
    return status === 'cloning' || status === 'error' || warnings.length > 0;
  });
}
