import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import { ButtonComponent, InlineBannerComponent, SpinnerComponent } from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { AddRepositoryGuideComponent } from '../../components/add-repository-guide/add-repository-guide.component';
import { RecentRepositoriesComponent } from '../../components/recent-repositories/recent-repositories.component';
import { DashboardHintService } from '../../services/dashboard-hint/dashboard-hint.service';

type RecentList =
  | { kind: 'loading'; }
  | { kind: 'failed'; }
  | { kind: 'loaded'; repositories: readonly RepositorySummary[]; };

/**
 * The home page of a logged-in user (REQ-DASH-001): the Add a repository guide,
 * shown at once, then the recent repositories once they have loaded.
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

  protected readonly list = signal<RecentList>({ kind: 'loading' });
  protected readonly retrying = signal(false);
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
    const user = this.currentUser.user();
    return user !== undefined && this.hint.hadRepositories(user.id) ? 'compact' : 'full';
  });

  constructor() {
    void this.load();
  }

  protected async retry(): Promise<void> {
    this.retrying.set(true);
    try {
      await this.load();
    } finally {
      this.retrying.set(false);
    }
  }

  private async load(): Promise<void> {
    let repositories: readonly RepositorySummary[];
    try {
      ({ repositories } = await firstValueFrom(this.api.recent()));
    } catch {
      this.list.set({ kind: 'failed' });
      return;
    }
    this.list.set({ kind: 'loaded', repositories });
    const user = await this.currentUser.load().catch(() => undefined);
    if (user !== undefined) {
      this.hint.remember(user.id, repositories.length > 0);
    }
  }
}
