import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  FieldComponent,
  InlineBannerComponent,
  InputComponent,
  PageComponent,
  PageTitleDirective,
  SpinnerComponent
} from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { AddRepositoryGuideComponent, RepositoryListUpdatesService } from '@front-burner/web-shell';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { RepositoryListEntryComponent } from '../../components/repository-list-entry/repository-list-entry.component';

type RepositoryList =
  | { kind: 'loading'; }
  | { kind: 'failed'; }
  | { kind: 'loaded'; repositories: readonly RepositorySummary[]; };

/**
 * The repository management page (RM-4, RM-5): all of the user's
 * repositories, in the order of the API (sorted by name), with a filter on the
 * name and the remote, **Add repository**, and **Open** for openable ones. A
 * user without repositories sees the full guide instead. While it is open,
 * `RepositoryListUpdatesService` keeps each repository's status current (RM-7).
 * Loading and a failed load behave as on the dashboard (DS-25, DS-26).
 */
@Component({
  selector: 'repo-repositories',
  imports: [
    TranslocoDirective,
    RouterLink,
    PageComponent,
    PageTitleDirective,
    ButtonComponent,
    FieldComponent,
    InputComponent,
    InlineBannerComponent,
    SpinnerComponent,
    AddRepositoryGuideComponent,
    RepositoryListEntryComponent
  ],
  templateUrl: './repositories.page.html',
  styleUrl: './repositories.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositoriesPage {
  private readonly api = inject(RepositoriesApi);
  private readonly listUpdates = inject(RepositoryListUpdatesService);

  protected readonly list = signal<RepositoryList>({ kind: 'loading' });
  protected readonly retrying = signal(false);
  /** The filter as typed. */
  protected readonly query = signal('');
  /** The number of the latest request for the list. */
  private loads = 0;
  /** Whether the latest request for the list is still running. */
  private readonly loading = signal(false);

  protected readonly repositories = computed(() => {
    const list = this.list();
    return list.kind === 'loaded' ? list.repositories : null;
  });

  /** The filter without the spaces around it, as "No repositories match" quotes it. */
  protected readonly trimmedQuery = computed(() => this.query().trim());
  /** The filter, trimmed and in lower case; empty when it filters nothing. */
  private readonly needle = computed(() => this.trimmedQuery().toLocaleLowerCase());

  /** The repositories that match the filter, in the order of the list. */
  protected readonly matches = computed(() => {
    const repositories = this.repositories() ?? [];
    const needle = this.needle();
    if (needle === '') {
      return repositories;
    }
    return repositories.filter(repository =>
      repository.name.toLocaleLowerCase().includes(needle) || repository.remote.toLocaleLowerCase().includes(needle)
    );
  });

  /** Whether the filter is in use, so that the number of matches is announced. */
  protected readonly filtering = computed(() => this.needle() !== '');

  constructor() {
    void this.load();
    this.listUpdates.follow({
      repositories: this.repositories,
      loading: this.loading,
      update: repositories => this.list.set({ kind: 'loaded', repositories }),
      reload: () => void this.load({ keepOnFailure: true })
    });
  }

  protected filter(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected async retry(): Promise<void> {
    this.retrying.set(true);
    try {
      await this.load();
    } finally {
      this.retrying.set(false);
    }
  }

  /**
   * Fetches the list; only the answer to the latest request counts.
   * `keepOnFailure`: a reload that fails leaves the list on screen as it was.
   */
  private async load(options: { keepOnFailure?: boolean; } = {}): Promise<void> {
    const request = ++this.loads;
    this.loading.set(true);
    try {
      const { repositories } = await firstValueFrom(this.api.list());
      if (request === this.loads) {
        this.list.set({ kind: 'loaded', repositories });
      }
    } catch {
      if (request === this.loads && !(options.keepOnFailure && this.list().kind === 'loaded')) {
        this.list.set({ kind: 'failed' });
      }
    } finally {
      if (request === this.loads) {
        this.loading.set(false);
      }
    }
  }
}
