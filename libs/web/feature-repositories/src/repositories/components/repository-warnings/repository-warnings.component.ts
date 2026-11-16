import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import {
  type ChangedHostKey,
  ChangedHostKeySchema,
  type RepositoryDetails,
  type RepositoryWarning
} from '@front-burner/shared-contracts';
import { ButtonComponent, DialogService, InlineBannerComponent, ToastService } from '@front-burner/ui';
import { GitApi, RepositoriesApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { ChangedHostKeyDialog, UnlockKeyDialog, type UnlockKeyDialogData } from '@front-burner/web-repository-dialogs';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { RepositorySettingsStore } from '../../services/repository-settings-store/repository-settings-store.service';
import type { CredentialsInUseComponent } from '../credentials-in-use/credentials-in-use.component';

const KEY = 'web-feature-repositories.RepositoryWarningsComponent';

/** The warnings after which a fetch runs, so that a fetch's warning can go without opening the repository. */
const FETCH_AFTER: ReadonlySet<RepositoryWarning> = new Set([
  'credentials-refused',
  'host-key-changed',
  'key-locked'
]);

let nextId = 0;

/**
 * The **Warnings** of the settings page (RM-8, RC-6): one line per warning of
 * the repository, with its text, the warning's icon (NF-13.7) and its fix:
 *
 * - "Credentials refused": **Fix credentials**, the repository credentials
 *   dialog in its RC-12 mode, through the **Credentials** section;
 * - "Can't push with these credentials": **Use other credentials** (RC-7);
 * - "Server identity changed": **Review the new key**, the changed host key
 *   dialog with the new key from the stored problem (RC-21);
 * - "Key locked": **Unlock**, the unlock dialog for the repository's key (RC-16).
 *
 * A fix runs no other git operation: a warning goes when the next operation
 * of its kind succeeds (RM-8). After **Fix credentials**, **Review the new
 * key** and **Unlock**, a fetch runs at once through the API, saying nothing,
 * so that a fetch's warning can go without opening the repository; how it
 * ends arrives as `repository.warning`. "Can't push with these credentials"
 * goes with the change of credentials itself. _(Plan 120's calls.)_ The page's
 * store reads the details again after a fix; cancelling one changes nothing.
 * One fix runs at a time, and its button is busy meanwhile.
 */
@Component({
  selector: 'repo-repository-warnings',
  imports: [ TranslocoDirective, ButtonComponent, InlineBannerComponent ],
  templateUrl: './repository-warnings.component.html',
  styleUrl: './repository-warnings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.none]': 'warnings().length === 0' }
})
export class RepositoryWarningsComponent {
  readonly details = input.required<RepositoryDetails>();
  /** The page's **Credentials** section, whose dialog the credential fixes open. */
  readonly credentials = input.required<CredentialsInUseComponent>();

  private readonly dialogs = inject(DialogService);
  private readonly git = inject(GitApi);
  private readonly repositories = inject(RepositoriesApi);
  private readonly store = inject(RepositorySettingsStore);
  private readonly toast = inject(ToastService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly transloco = inject(TranslocoService);

  protected readonly headingId = `repo-repository-warnings-heading-${nextId++}`;
  protected readonly warnings = computed(() => this.details().summary.warnings);
  /** The warning whose fix runs, or `null`. */
  protected readonly running = signal<RepositoryWarning | null>(null);

  /** Runs the fix of `warning`; nothing while another runs. */
  protected async fix(warning: RepositoryWarning): Promise<void> {
    if (this.running() !== null) {
      return;
    }
    this.running.set(warning);
    const id = this.details().summary.id;
    try {
      if (!await this.runFix(warning)) {
        return;
      }
      if (FETCH_AFTER.has(warning)) {
        await this.fetch(id);
      }
    } finally {
      this.running.set(null);
    }
  }

  /** True when the fix was made; the credentials dialog reloads the store itself. */
  private async runFix(warning: RepositoryWarning): Promise<boolean> {
    switch (warning) {
      case 'credentials-refused':
        return this.credentials().change({ hint: 'refused-key', offerTokenUpdate: true });
      case 'cannot-push':
        return this.credentials().change({});
      case 'host-key-changed':
        return this.reloadIf(await this.reviewHostKey());
      case 'key-locked':
        return this.reloadIf(await this.unlock());
    }
  }

  private reloadIf(fixed: boolean): boolean {
    if (fixed) {
      this.store.reload();
    }
    return fixed;
  }

  /**
   * The changed host key dialog with the keys of the stored problem (RC-21):
   * the last fetch's or pull's, else the last push's. True once the new key is
   * trusted, or on **Try again** when there was no new key to trust.
   */
  private async reviewHostKey(): Promise<boolean> {
    const { fetch, push } = this.details().remoteProblems;
    const problem = [ fetch, push ].find(stored => stored?.code === 'host-key-changed');
    const parsed = ChangedHostKeySchema.safeParse(problem?.params);
    if (!parsed.success) {
      return false;
    }
    const ref = this.dialogs.open<ChangedHostKeyDialog, ChangedHostKey, boolean>(ChangedHostKeyDialog, {
      data: parsed.data
    });
    return await firstValueFrom(ref.closed, { defaultValue: undefined }) === true;
  }

  /**
   * Asks for the passphrase of the repository's key (RC-16), whose name, type
   * and fingerprint the dialog shows, so the credentials in use are read
   * first. A key unlocked meanwhile, such as in another tab, needs nothing.
   */
  private async unlock(): Promise<boolean> {
    let key: UnlockKeyDialogData;
    try {
      const inUse = (await firstValueFrom(this.repositories.repositoryCredentials(this.details().summary.id))).inUse;
      if (inUse?.kind !== 'ssh-key' || !inUse.passphraseProtected || inUse.missing) {
        // Not a locked key any more: the store shows what the repository has now.
        this.store.reload();
        return false;
      }
      if (inUse.unlocked) {
        return true;
      }
      key = { id: inUse.id, name: inUse.name, keyType: inUse.keyType, fingerprint: inUse.fingerprint };
    } catch (error) {
      this.toast.show({
        message: this.errorText.describe(toApiError(error)).text,
        dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
        status: 'danger'
      });
      return false;
    }
    const ref = this.dialogs.open<UnlockKeyDialog, UnlockKeyDialogData, boolean>(UnlockKeyDialog, { data: key });
    return await firstValueFrom(ref.closed, { defaultValue: undefined }) === true;
  }

  /**
   * Fetches, saying nothing: a fetch that cannot start, or fails, keeps or
   * brings back its warning, which the page shows (RC-6).
   */
  private async fetch(id: number): Promise<void> {
    try {
      await firstValueFrom(this.git.fetch(id));
    } catch {
      // The warning stays, with its fix.
    }
  }
}
