import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import { TranslocoDirective } from '@jsverse/transloco';

import { RepositoryEntryComponent } from '../repository-entry/repository-entry.component';

/** The Recent repositories section (DS-15 to DS-24): the list as the API ordered it, and All repositories. */
@Component({
  selector: 'dash-recent-repositories',
  imports: [ TranslocoDirective, RouterLink, RepositoryEntryComponent ],
  templateUrl: './recent-repositories.component.html',
  styleUrl: './recent-repositories.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RecentRepositoriesComponent {
  readonly repositories = input.required<readonly RepositorySummary[]>();
}
