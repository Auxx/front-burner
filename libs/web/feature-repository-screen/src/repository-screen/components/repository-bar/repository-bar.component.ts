import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { CurrentUser, RepositorySummary } from '@front-burner/shared-contracts';
import type { SaveStatus } from '@front-burner/web-core';
import { BrandLinkComponent, UserMenuComponent } from '@front-burner/web-shell';

import { RepositorySwitcherComponent } from '../repository-switcher/repository-switcher.component';
import { SaveStatusComponent } from '../save-status/save-status.component';

/**
 * The repository screen's one bar, the app header and the repository's header
 * in one (NV-9, FB-10): the product's icon as a link to the dashboard, the
 * repository name, which opens the repository switcher (NV-10), the open
 * file's save status (ED-18), and the user menu. The **Files** toggle is in
 * the activity bar (FB-7, FB-9).
 */
@Component({
  selector: 'rs-repository-bar',
  imports: [
    BrandLinkComponent,
    UserMenuComponent,
    RepositorySwitcherComponent,
    SaveStatusComponent
  ],
  templateUrl: './repository-bar.component.html',
  styleUrl: './repository-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositoryBarComponent {
  readonly repository = input.required<RepositorySummary>();
  /** The logged-in user, once loaded. */
  readonly user = input<CurrentUser>();
  /** Whether there is a file tree to show; not for a repository that cannot be opened (FB-3). */
  readonly withFiles = input(true);
  /** Whether the screen uses its narrow layout. */
  readonly narrow = input(false);
  /** The open file's save status; `null` without one. */
  readonly saveStatus = input<SaveStatus | null>(null);
}
