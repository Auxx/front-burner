import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  InlineBannerComponent,
  PageComponent,
  PageTitleDirective,
  SpinnerComponent,
  ToastService
} from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { AddRepositoryGuideComponent, followRepositoryList } from '@front-burner/web-shell';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

import { RecentRepositoriesComponent } from '../../components/recent-repositories/recent-repositories.component';
import { DashboardHintService } from '../../services/dashboard-hint/dashboard-hint.service';

const KEY = 'web-feature-dashboard.DashboardPage';

/**
 * The home page of a logged-in user (REQ-DASH-001): the Add a repository guide,
 * shown at once, then the recent repositories once they have loaded.
 * `followRepositoryList` loads them and keeps each repository's status and
 * clone progress current while the page is open (DS-23).
 */
@Component({
  selector: 'dash-dashboard',
  imports: [
    TranslocoDirective,
    PageComponent,
    PageTitleDirective,
    ButtonComponent,
    InlineBannerComponent,
    SpinnerComponent,
    AddRepositoryGuideComponent,
    RecentRepositoriesComponent
  ],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardPage {
  private readonly api = inject(RepositoriesApi);
  private readonly currentUser = inject(CurrentUserService);
  private readonly hint = inject(DashboardHintService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly list = followRepositoryList(() => this.api.recent(), {
    loaded: repositories => void this.rememberForm(repositories)
  });

  /** Compact once the user has repositories; until the list has loaded, as it was last time (DS-25). */
  protected readonly guideForm = computed<'full' | 'compact'>(() => {
    const repositories = this.list.repositories();
    if (repositories !== null) {
      return repositories.length > 0 ? 'compact' : 'full';
    }
    return this.hint.hadRepositories(this.currentUser.user()?.id) ? 'compact' : 'full';
  });

  constructor() {
    this.announceAdded();
  }

  protected retry(): void {
    void this.list.retry();
  }

  /** The message of AR-45, after the Add repository page sent the user here. */
  private announceAdded(): void {
    const name = this.router.currentNavigation()?.extras.state?.['addedRepository'];
    if (typeof name !== 'string') {
      return;
    }
    this.toast.show({
      message: this.transloco.translate(`${KEY}.added`, { name }),
      dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
      status: 'info'
    });
    // The router restores this state on reload and on Back: drop it, so that the message shows once.
    const state = (this.location.getState() ?? {}) as Record<string, unknown>;
    this.location.replaceState(
      this.location.path(),
      '',
      Object.fromEntries(Object.entries(state).filter(([ key ]) => key !== 'addedRepository'))
    );
  }

  /** Remembers whether the user has repositories, for the guide's form on the next visit (DS-25). */
  private async rememberForm(repositories: readonly RepositorySummary[]): Promise<void> {
    const user = await this.currentUser.load().catch(() => undefined);
    if (user !== undefined) {
      this.hint.remember(user.id, repositories.length > 0);
    }
  }
}
