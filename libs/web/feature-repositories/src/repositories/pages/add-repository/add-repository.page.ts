import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { apply, disabled, type FieldTree, form, submit } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import {
  type AddRepositoryRequest,
  type ApiError,
  GIT_LEVELS,
  type GitLevel,
  type HostKey,
  HostKeySchema,
  type RepositoryIndex,
  type SavedCredentials
} from '@front-burner/shared-contracts';
import { parseRemoteUrl } from '@front-burner/shared-util';
import {
  BreadcrumbDirective,
  BreadcrumbsComponent,
  ButtonComponent,
  DialogService,
  InlineBannerComponent
} from '@front-burner/ui';
import { CredentialsApi, KnownHostsApi, RepositoriesApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, CurrentUserService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { CloneSectionComponent } from '../../components/clone-section/clone-section.component';
import { CredentialsSectionComponent } from '../../components/credentials-section/credentials-section.component';
import { LevelSectionComponent } from '../../components/level-section/level-section.component';
import { RemoteSectionComponent } from '../../components/remote-section/remote-section.component';
import { TrustHostDialog } from '../../dialogs/trust-host/trust-host.dialog';
import type { LeavesWithCare } from '../../guards/unsaved-changes/unsaved-changes.guard';
import {
  addRepositorySchema,
  emptyAddRepositoryForm,
  toRepositoryCredentials
} from '../../models/add-repository-form.model';
import { BranchListService } from '../../services/branch-list/branch-list.service';
import { SessionKeysService } from '../../services/session-keys/session-keys.service';
import { SubmitFailuresService } from '../../services/submit-failures/submit-failures.service';
import { failureTexts } from '../../utils/add-repository-errors';

const KEY = 'web-feature-repositories.AddRepositoryPage';
const NO_CREDENTIALS: SavedCredentials = { https: [], sshKeys: [] };

/** The user cancelled the host key dialog: the form stays as it was (AR-32). */
class HostNotTrusted extends Error {}

/** The host key of an unknown SSH server, if that is why a request failed (AR-32). */
function unknownHostKey(apiError: ApiError): HostKey | undefined {
  if (apiError.code !== 'host-key-unknown') {
    return undefined;
  }
  const parsed = HostKeySchema.safeParse(apiError.params);
  return parsed.success ? parsed.data : undefined;
}

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
    LevelSectionComponent,
    ButtonComponent,
    InlineBannerComponent
  ],
  templateUrl: './add-repository.page.html',
  styleUrl: './add-repository.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ SessionKeysService, BranchListService, SubmitFailuresService ],
  host: {
    '(window:beforeunload)': 'warnBeforeUnload($event)'
  }
})
export class AddRepositoryPage implements LeavesWithCare {
  private readonly repositoriesApi = inject(RepositoriesApi);
  private readonly credentialsApi = inject(CredentialsApi);
  private readonly currentUser = inject(CurrentUserService);
  private readonly branchList = inject(BranchListService);
  private readonly knownHostsApi = inject(KnownHostsApi);
  private readonly dialogs = inject(DialogService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly failures = inject(SubmitFailuresService);

  protected readonly index = signal<RepositoryIndex['repositories']>([]);
  private readonly sessionKeys = inject(SessionKeysService);
  /** The user's saved credentials as loaded; `null` while they load. */
  private readonly loaded = signal<SavedCredentials | null>(null);
  /** With this visit's generated key and unlocks (AR-25, AR-30). */
  protected readonly saved = computed(() => {
    const loaded = this.loaded();
    return loaded === null ? null : this.sessionKeys.withSessionKeys(loaded);
  });
  /** A submit is running: the whole form is read-only meanwhile (AR-7). */
  protected readonly submitting = signal(false);
  protected readonly model = form(signal(emptyAddRepositoryForm('advanced')), path => {
    apply(
      path,
      addRepositorySchema({
        index: this.index,
        saved: computed(() => this.saved() ?? NO_CREDENTIALS),
        generated: this.sessionKeys.generated
      })
    );
    disabled(path, () => this.submitting());
  });
  /** A failure that concerns no single field, shown above the buttons (AR-6). */
  protected readonly failure = signal<{ text: string; reference: string | null; } | null>(null);
  /** The repository was added: leaving needs no confirmation. */
  private added = false;
  /**
   * The page the user came from in the web client: while this page is
   * created, the last successful navigation is still the one before it. A
   * navigation rather than `history.back()`, whose entry is stale once the
   * guard has cancelled a back navigation.
   */
  private readonly cameFrom = this.router.lastSuccessfulNavigation()?.finalUrl;

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

  /**
   * **Add repository** is available once the form is valid, no request of the
   * form runs, and a single-branch clone has its branch list (AR-7).
   */
  protected readonly ready = computed(() =>
    !this.submitting()
    && this.model().valid()
    && !this.sessionKeys.busy()
    && (this.model.cloneMode().value() !== 'single-branch' || this.branchList.state().kind === 'loaded')
  );

  /**
   * Whether the user changed anything (AR-48). Generating a key does not
   * count: the key stays in the user's profile whatever they do (AR-30).
   */
  private readonly changed = computed(() => {
    const model = this.model;
    const credentials = model.credentials;
    const fields: FieldTree<unknown>[] = [
      model.remoteUrl,
      model.name,
      credentials.savedId,
      credentials.name,
      credentials.username,
      credentials.password,
      credentials.privateKey,
      credentials.passphrase,
      model.cloneMode,
      model.branch,
      model.understood,
      model.gitLevel
    ];
    if (credentials.choice().value() !== 'generate') {
      fields.push(credentials.choice);
    }
    return fields.some(field => field().dirty());
  });

  constructor() {
    // A failure stays on its field until the inputs change; passphrases are cleared after it (AR-46).
    this.failures.watch(computed(() => {
      const value = this.model().value();
      return JSON.stringify({
        ...value,
        credentials: { ...value.credentials, passphrase: '' },
        generated: this.sessionKeys.generated()?.key.id
      });
    }));
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
    // An unknown SSH host met by the branch list: trust it and check again, or leave it (AR-32).
    effect(() => {
      const state = this.branchList.state();
      const hostKey = state.kind === 'failed' ? unknownHostKey(state.error) : undefined;
      if (hostKey !== undefined) {
        untracked(() => void this.trustAndRetryBranchList(hostKey));
      }
      // A key whose unlock ended since the page loaded asks for its passphrase again (AR-31).
      const locked = state.kind === 'failed'
        && state.error.fields?.some(field =>
          field.path === 'credentials.passphrase' && field.code === 'passphrase-required'
        );
      if (locked) {
        untracked(() => {
          const { choice, savedId } = this.model.credentials().value();
          if (choice === 'saved') {
            this.sessionKeys.markLocked(savedId);
          }
        });
      }
    });
  }

  canLeave(): boolean | Promise<boolean> {
    if (this.added || !this.changed()) {
      return true;
    }
    return this.dialogs.confirm({
      heading: this.transloco.translate(`${KEY}.discard.heading`),
      message: this.transloco.translate(`${KEY}.discard.message`),
      confirmLabel: this.transloco.translate(`${KEY}.discard.confirm`),
      cancelLabel: this.transloco.translate(`${KEY}.discard.cancel`),
      variant: 'danger'
    });
  }

  /** Closing or reloading the tab with changes asks the browser's own question (AR-48). */
  protected warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.added && this.changed()) {
      event.preventDefault();
    }
  }

  /** Back to where the user came from in the web client, or the dashboard (AR-47). */
  protected async cancel(): Promise<void> {
    await this.router.navigateByUrl(this.cameFrom ?? '/');
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.submitting()) {
      return;
    }
    await submit(this.model, async () => {
      if (!this.ready()) {
        return undefined;
      }
      const request = this.request();
      this.submitting.set(true);
      this.failure.set(null);
      this.failures.clear();
      try {
        await this.trusting(() => firstValueFrom(this.repositoriesApi.add(request)));
      } catch (error) {
        if (error instanceof HostNotTrusted) {
          return undefined;
        }
        // AR-46: everything else stays.
        this.model.credentials.passphrase().value.set('');
        this.refusal(error);
        return undefined;
      } finally {
        this.submitting.set(false);
      }
      this.added = true;
      await this.router.navigateByUrl('/', { state: { addedRepository: request.name } });
      return undefined;
    });
  }

  private request(): AddRepositoryRequest {
    const value = this.model().value();
    const credentials = toRepositoryCredentials(value.credentials, this.sessionKeys.generated());
    if (credentials === undefined) {
      throw new Error('The form is valid, so its credentials are complete');
    }
    return {
      remoteUrl: value.remoteUrl.trim(),
      name: value.name.trim(),
      credentials,
      cloneMode: value.cloneMode,
      ...(value.cloneMode === 'single-branch' ? { branch: value.branch } : {}),
      // Until the allowed levels are known, the backend picks the highest (AR-39).
      ...(this.allowedLevels().length > 0 ? { gitLevel: value.gitLevel } : {})
    };
  }

  /**
   * Runs `request`; if it meets an unknown SSH host, asks the user to trust it
   * and runs it once more (AR-32). Throws {@link HostNotTrusted} on Cancel.
   */
  private async trusting<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      const hostKey = unknownHostKey(toApiError(error));
      if (hostKey === undefined) {
        throw error;
      }
      await this.trust(hostKey);
      return request();
    }
  }

  private async trust(hostKey: HostKey): Promise<void> {
    const ref = this.dialogs.open<TrustHostDialog, HostKey, boolean>(TrustHostDialog, { data: hostKey, size: 'small' });
    if ((await firstValueFrom(ref.closed)) !== true) {
      throw new HostNotTrusted();
    }
    const { host, port, type, key } = hostKey;
    await firstValueFrom(this.knownHostsApi.trust({ host, port, type, key }), { defaultValue: undefined });
  }

  private async trustAndRetryBranchList(hostKey: HostKey): Promise<void> {
    try {
      await this.trust(hostKey);
    } catch {
      // Cancelled, or not saved: the branch list shows the failure, with Try again.
      return;
    }
    this.branchList.retry();
  }

  /**
   * Puts each failure on its field, or above the buttons when it concerns no
   * field the form shows (AR-6, AR-42). Field failures are not form errors, so
   * the same inputs can be submitted again (see {@link SubmitFailuresService}).
   */
  private refusal(error: unknown): void {
    const apiError = toApiError(error);
    const failures = failureTexts(apiError);
    const credentials = this.model.credentials().value();
    if (
      credentials.choice === 'saved'
      && failures.some(failure =>
        failure.path === 'credentials.passphrase' && failure.key?.endsWith('passphrase-required')
      )
    ) {
      // The key's unlock ended since the page loaded (AR-31): ask for the passphrase again.
      this.sessionKeys.markLocked(credentials.savedId);
    }
    this.failures.record(failures.filter(failure => failure.path !== null && this.shows(failure.path)));
    const elsewhere = failures.find(failure => failure.path === null || !this.shows(failure.path));
    if (elsewhere === undefined) {
      return;
    }
    this.failure.set(
      elsewhere.key === null
        ? this.errorText.describe(apiError)
        : {
          text: this.transloco.translate(`web-feature-repositories.errors.${elsewhere.key}`, elsewhere.params),
          reference: null
        }
    );
  }

  /** Whether the form shows the field the API's `path` names. */
  private shows(path: string): boolean {
    const model = this.model;
    const { choice, savedId } = model.credentials().value();
    const key = this.saved()?.sshKeys.find(sshKey => sshKey.id === savedId);
    const shown: Record<string, boolean> = {
      remoteUrl: true,
      name: true,
      credentials: this.protocol() !== undefined,
      'credentials.name': choice === 'new-https' || choice === 'new-ssh-key',
      'credentials.username': choice === 'new-https',
      'credentials.password': choice === 'new-https',
      'credentials.privateKey': choice === 'new-ssh-key',
      'credentials.passphrase': choice === 'new-ssh-key'
        || (choice === 'saved' && key !== undefined && key.passphraseProtected && !key.unlocked),
      branch: model.cloneMode().value() === 'single-branch',
      gitLevel: this.allowedLevels().length > 1
    };
    return shown[path] ?? false;
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
