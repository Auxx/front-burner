import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { form } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import type { RepositoryIndex, SavedCredentials } from '@front-burner/shared-contracts';
import { parseRemoteUrl } from '@front-burner/shared-util';
import { BreadcrumbDirective, BreadcrumbsComponent } from '@front-burner/ui';
import { CredentialsApi, RepositoriesApi } from '@front-burner/web-api-client';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { CredentialsSectionComponent } from '../../components/credentials-section/credentials-section.component';
import { RemoteSectionComponent } from '../../components/remote-section/remote-section.component';
import { addRepositorySchema, emptyAddRepositoryForm } from '../../models/add-repository-form.model';
import { SessionKeysService } from '../../services/session-keys/session-keys.service';

const NO_CREDENTIALS: SavedCredentials = { https: [], sshKeys: [] };

/**
 * The Add repository page (REQ-REPO-001): one form, split into a component per
 * section, each given its slice of the page's model.
 */
@Component({
  selector: 'repo-add-repository',
  imports: [
    TranslocoDirective,
    RouterLink,
    BreadcrumbsComponent,
    BreadcrumbDirective,
    RemoteSectionComponent,
    CredentialsSectionComponent
  ],
  templateUrl: './add-repository.page.html',
  styleUrl: './add-repository.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ SessionKeysService ]
})
export class AddRepositoryPage {
  private readonly repositoriesApi = inject(RepositoriesApi);
  private readonly credentialsApi = inject(CredentialsApi);

  protected readonly index = signal<RepositoryIndex['repositories']>([]);
  private readonly sessionKeys = inject(SessionKeysService);
  /** The user's saved credentials as loaded; `null` while they load. */
  private readonly loaded = signal<SavedCredentials | null>(null);
  /** With this visit's generated key and unlocks (AR-25, AR-30). */
  protected readonly saved = computed(() => {
    const loaded = this.loaded();
    return loaded === null ? null : this.sessionKeys.withSessionKeys(loaded);
  });
  protected readonly model = form(
    signal(emptyAddRepositoryForm('advanced')),
    addRepositorySchema({
      index: this.index,
      saved: computed(() => this.saved() ?? NO_CREDENTIALS),
      generated: this.sessionKeys.generated
    })
  );

  /** The protocol of a valid remote URL, which decides the credentials shown (AR-11, AR-16). */
  readonly protocol = computed(() => {
    const result = parseRemoteUrl(this.model.remoteUrl().value().trim());
    return result.ok ? result.remote.protocol : undefined;
  });

  constructor() {
    void this.loadIndex();
    void this.loadCredentials();
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

  /** Without them, the user can still add new credentials or a public repository. */
  private async loadCredentials(): Promise<void> {
    try {
      this.loaded.set(await firstValueFrom(this.credentialsApi.list()));
    } catch {
      this.loaded.set(NO_CREDENTIALS);
    }
  }
}
