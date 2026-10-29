import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { CurrentUser, RepositorySummary } from '@front-burner/shared-contracts';
import { ButtonComponent, IconComponent } from '@front-burner/ui';
import type { SaveStatus } from '@front-burner/web-core';
import { BrandLinkComponent, UserMenuComponent } from '@front-burner/web-shell';
import { TranslocoDirective } from '@jsverse/transloco';

import { RepositorySwitcherComponent } from '../repository-switcher/repository-switcher.component';
import { SaveStatusComponent } from '../save-status/save-status.component';

/**
 * The repository screen's one bar, the app header and the repository's header
 * in one (NV-9, FB-10): the product's icon as a link to the dashboard, the
 * repository name, which opens the repository switcher (NV-10), the open
 * file's save status (ED-18), **Files**, and the user menu. **Files** collapses and
 * expands the file tree on wide screens, and opens it as a drawer on narrow
 * ones (FB-7, FB-9).
 */
@Component({
  selector: 'rs-repository-bar',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    IconComponent,
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
  /** Whether the file tree is shown: beside the editor, or as the drawer on narrow screens. */
  readonly filesOpen = input(true);
  /** The open file's save status; `null` without one. */
  readonly saveStatus = input<SaveStatus | null>(null);

  readonly toggleFiles = output();
}
