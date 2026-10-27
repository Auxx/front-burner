import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { form } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import type { RepositoryIndex } from '@front-burner/shared-contracts';
import { parseRemoteUrl } from '@front-burner/shared-util';
import { BreadcrumbDirective, BreadcrumbsComponent } from '@front-burner/ui';
import { RepositoriesApi } from '@front-burner/web-api-client';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { RemoteSectionComponent } from '../../components/remote-section/remote-section.component';
import { addRepositorySchema, emptyAddRepositoryForm } from '../../models/add-repository-form.model';

/**
 * The Add repository page (REQ-REPO-001): one form, split into a component per
 * section, each given its slice of the page's model.
 */
@Component({
  selector: 'repo-add-repository',
  imports: [ TranslocoDirective, RouterLink, BreadcrumbsComponent, BreadcrumbDirective, RemoteSectionComponent ],
  templateUrl: './add-repository.page.html',
  styleUrl: './add-repository.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AddRepositoryPage {
  private readonly repositoriesApi = inject(RepositoriesApi);

  protected readonly index = signal<RepositoryIndex['repositories']>([]);
  protected readonly model = form(
    signal(emptyAddRepositoryForm('advanced')),
    addRepositorySchema({ index: this.index })
  );

  /** The protocol of a valid remote URL, which decides the credentials shown (AR-11, AR-16). */
  readonly protocol = computed(() => {
    const result = parseRemoteUrl(this.model.remoteUrl().value().trim());
    return result.ok ? result.remote.protocol : undefined;
  });

  constructor() {
    void this.loadIndex();
  }

  /** Without the index, the backend's checks on submit are the only ones (AR-15). */
  private async loadIndex(): Promise<void> {
    try {
      const { repositories } = await firstValueFrom(this.repositoriesApi.index());
      this.index.set(repositories);
    } catch {
      // The early checks are a convenience only.
    }
  }
}
