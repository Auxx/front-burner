import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { form } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { GIT_LEVELS, type GitLevel, type RepositoryIndex, type SavedCredentials } from '@front-burner/shared-contracts';
import { parseRemoteUrl } from '@front-burner/shared-util';
import { BreadcrumbDirective, BreadcrumbsComponent } from '@front-burner/ui';
import { CredentialsApi, RepositoriesApi } from '@front-burner/web-api-client';
import { CurrentUserService } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { CloneSectionComponent } from '../../components/clone-section/clone-section.component';
import { CredentialsSectionComponent } from '../../components/credentials-section/credentials-section.component';
import { LevelSectionComponent } from '../../components/level-section/level-section.component';
import { RemoteSectionComponent } from '../../components/remote-section/remote-section.component';
import {
  addRepositorySchema,
  emptyAddRepositoryForm,
  toRepositoryCredentials
} from '../../models/add-repository-form.model';
import { BranchListService } from '../../services/branch-list/branch-list.service';
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
    CredentialsSectionComponent,
    CloneSectionComponent,
    LevelSectionComponent
  ],
  templateUrl: './add-repository.page.html',
  styleUrl: './add-repository.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ SessionKeysService, BranchListService ]
})
export class AddRepositoryPage {
  private readonly repositoriesApi = inject(RepositoriesApi);
  private readonly credentialsApi = inject(CredentialsApi);
  private readonly currentUser = inject(CurrentUserService);
  private readonly branchList = inject(BranchListService);

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

  /** The levels the administrator allows the user (AR-38); the dropdown waits for them. */
  protected readonly allowedLevels = signal<readonly GitLevel[]>([]);

  /** The protocol of a valid remote URL, which decides the credentials shown (AR-11, AR-16). */
  readonly protocol = computed(() => {
    const result = parseRemoteUrl(this.model.remoteUrl().value().trim());
    return result.ok ? result.remote.protocol : undefined;
  });

  /**
   * The inputs of the branch list's access check: a single-branch clone with
   * a valid URL and valid credentials (AR-35); `undefined` otherwise.
   */
  private readonly branchQuery = computed(
    () => {
      const model = this.model;
      if (
        model.cloneMode().value() !== 'single-branch' || model.remoteUrl().invalid() || model.credentials().invalid()
      ) {
        return undefined;
      }
      const credentials = toRepositoryCredentials(model.credentials().value(), this.sessionKeys.generated());
      return credentials === undefined ? undefined : { remoteUrl: model.remoteUrl().value().trim(), credentials };
    },
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) }
  );

  constructor() {
    void this.loadIndex();
    void this.loadCredentials();
    void this.loadLevels();
    effect(() => {
      const query = this.branchQuery();
      untracked(() => {
        if (query === undefined) {
          this.branchList.reset();
        } else {
          this.branchList.request(query.remoteUrl, query.credentials);
        }
      });
    });
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

  /** The highest allowed level is the default (AR-39); with one, it is the only one (AR-40). */
  private async loadLevels(): Promise<void> {
    let allowed: readonly GitLevel[];
    try {
      ({ allowedGitLevels: allowed } = await this.currentUser.load());
    } catch {
      // The backend uses the highest allowed level when none is sent.
      return;
    }
    const levels = GIT_LEVELS.filter(level => allowed.includes(level));
    this.allowedLevels.set(levels);
    const highest = levels[levels.length - 1];
    if (highest !== undefined) {
      this.model.gitLevel().value.set(highest);
    }
  }
}
