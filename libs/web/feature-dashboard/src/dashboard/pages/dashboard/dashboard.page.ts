import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
import { AddRepositoryGuideComponent, RepositoryListUpdatesService } from '@front-burner/web-shell';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { RecentRepositoriesComponent } from '../../components/recent-repositories/recent-repositories.component';
import { DashboardHintService } from '../../services/dashboard-hint/dashboard-hint.service';

const KEY = 'web-feature-dashboard.DashboardPage';

type RecentList =
  | { kind: 'loading'; }
  | { kind: 'failed'; }
  | { kind: 'loaded'; repositories: readonly RepositorySummary[]; };

/**
 * The home page of a logged-in user (REQ-DASH-001): the Add a repository guide,
 * shown at once, then the recent repositories once they have loaded. While it
 * is open, `RepositoryListUpdatesService` keeps each repository's status
 * current (DS-23).
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
  private readonly listUpdates = inject(RepositoryListUpdatesService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly list = signal<RecentList>({ kind: 'loading' });
  protected readonly retrying = signal(false);
  /** The number of the latest request for the list. */
  private loads = 0;
  protected readonly repositories = computed(() => {
    const list = this.list();
    return list.kind === 'loaded' ? list.repositories : null;
  });

  /** Compact once the user has repositories; until the list has loaded, as it was last time (DS-25). */
  protected readonly guideForm = computed<'full' | 'compact'>(() => {
    const repositories = this.repositories();
    if (repositories !== null) {
      return repositories.length > 0 ? 'compact' : 'full';
    }
    return this.hint.hadRepositories(this.currentUser.user()?.id) ? 'compact' : 'full';
  });

  constructor() {
    void this.load();
    this.announceAdded();
    this.listUpdates.follow({
      repositories: this.repositories,
      update: repositories => this.list.set({ kind: 'loaded', repositories }),
      reload: () => void this.load({ keepOnFailure: true })
    });
  }

  protected async retry(): Promise<void> {
    this.retrying.set(true);
    try {
      await this.load();
    } finally {
      this.retrying.set(false);
    }
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

  /**
   * Fetches the list; only the answer to the latest request counts.
   * `keepOnFailure`: a reload that fails leaves the list on screen as it was.
   */
  private async load(options: { keepOnFailure?: boolean; } = {}): Promise<void> {
    const request = ++this.loads;
    let repositories: readonly RepositorySummary[];
    try {
      ({ repositories } = await firstValueFrom(this.api.recent()));
    } catch {
      if (request === this.loads && !(options.keepOnFailure && this.list().kind === 'loaded')) {
        this.list.set({ kind: 'failed' });
      }
      return;
    }
    if (request !== this.loads) {
      return;
    }
    this.list.set({ kind: 'loaded', repositories });
    const user = await this.currentUser.load().catch(() => undefined);
    if (user !== undefined) {
      this.hint.remember(user.id, repositories.length > 0);
    }
  }
}
