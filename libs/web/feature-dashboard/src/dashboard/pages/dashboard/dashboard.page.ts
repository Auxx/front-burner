import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import type { PushEvent, RepositorySummary } from '@front-burner/shared-contracts';
import { ButtonComponent, InlineBannerComponent, SpinnerComponent, ToastService } from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { CurrentUserService, PushChannelService } from '@front-burner/web-core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { AddRepositoryGuideComponent } from '../../components/add-repository-guide/add-repository-guide.component';
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
 * is open, the push channel keeps each repository's status current (DS-23).
 */
@Component({
  selector: 'dash-dashboard',
  imports: [
    TranslocoDirective,
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
  private readonly push = inject(PushChannelService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  protected readonly list = signal<RecentList>({ kind: 'loading' });
  protected readonly retrying = signal(false);
  /** The number of the latest request for the list. */
  private loads = 0;
  /** A status event came while the list was loading. */
  private reloadAfterLoad = false;
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
    // Events are notifications only: after every (re)connect the list is fetched again (A-3.11).
    this.push.events.pipe(takeUntilDestroyed()).subscribe(event => this.onEvent(event));
    this.push.reconnected.pipe(takeUntilDestroyed()).subscribe(() => void this.load({ keepOnFailure: true }));
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

  /** Updates a listed repository in place; one not listed may belong at the top, so the list is fetched again. */
  private onEvent(event: PushEvent): void {
    if (event.type !== 'repository.status') {
      return;
    }
    const list = this.list();
    if (list.kind !== 'loaded') {
      // The answer on its way may predate the event.
      this.reloadAfterLoad = true;
      return;
    }
    if (!list.repositories.some(repository => repository.id === event.repositoryId)) {
      void this.load({ keepOnFailure: true });
      return;
    }
    this.list.set({
      kind: 'loaded',
      repositories: list.repositories.map(repository =>
        repository.id === event.repositoryId ? { ...repository, status: event.status, error: event.error } : repository
      )
    });
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
    if (this.reloadAfterLoad) {
      this.reloadAfterLoad = false;
      void this.load({ keepOnFailure: true });
    }
    const user = await this.currentUser.load().catch(() => undefined);
    if (user !== undefined) {
      this.hint.remember(user.id, repositories.length > 0);
    }
  }
}
