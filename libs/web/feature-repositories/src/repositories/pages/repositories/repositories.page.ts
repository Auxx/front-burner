import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
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
import { AddRepositoryGuideComponent, followRepositoryList } from '@front-burner/web-shell';
import { TranslocoDirective } from '@jsverse/transloco';

import { RepositoryListEntryComponent } from '../../components/repository-list-entry/repository-list-entry.component';

/**
 * The repository management page (RM-4, RM-5): all of the user's
 * repositories, in the order of the API (sorted by name), with a filter on the
 * name and the remote, **Add repository**, and **Open** for openable ones. A
 * user without repositories sees the full guide instead. `followRepositoryList`
 * loads the list and keeps each repository's status and clone progress
 * current (RM-7); loading and a failed load behave as on the dashboard (DS-25,
 * DS-26).
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

  protected readonly list = followRepositoryList(() => this.api.list());
  /** The filter as typed. */
  protected readonly query = signal('');

  /** The filter without the spaces around it, as "No repositories match" quotes it. */
  protected readonly trimmedQuery = computed(() => this.query().trim());
  /** The filter, trimmed and in lower case; empty when it filters nothing. */
  private readonly needle = computed(() => this.trimmedQuery().toLocaleLowerCase());

  /** The repositories that match the filter, in the order of the list. */
  protected readonly matches = computed(() => {
    const repositories = this.list.repositories() ?? [];
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

  protected filter(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected retry(): void {
    void this.list.retry();
  }
}
