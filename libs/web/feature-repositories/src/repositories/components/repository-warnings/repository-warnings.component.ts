import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { RepositoryDetails, RepositoryWarning } from '@front-burner/shared-contracts';
import { ButtonComponent, InlineBannerComponent, type Status, ToastService } from '@front-burner/ui';
import { GitApi, RepositoriesApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { KeyDialogsService, type ProtectedKey, protectedKeyOf } from '@front-burner/web-repository-dialogs';
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

/** The warnings that a push's stored problem can hold, with that problem's code; only a push clears them then. */
const PUSH_CODES: Partial<Record<RepositoryWarning, string>> = {
  'credentials-refused': 'credentials-refused',
  'host-key-changed': 'host-key-changed'
};

/** One warning's line: whether its fix runs, or another's does. */
interface WarningLine {
  readonly warning: RepositoryWarning;
  readonly busy: boolean;
  readonly unavailable: boolean;
}

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
 * ends arrives as `repository.warning`, which reloads the page's store, as
 * `key.unlocked` does. "Can't push with these credentials" goes with the
 * change of credentials itself. A warning that the last push left goes only
 * when a push succeeds, which this page does not start, so after its fix a
 * notice says so. _(Plan 120's calls.)_ Cancelling a fix changes nothing.
 *
 * One fix runs at a time: its button is busy, and the others are unavailable.
 */
@Component({
  selector: 'repo-repository-warnings',
  imports: [ TranslocoDirective, ButtonComponent, InlineBannerComponent ],
  templateUrl: './repository-warnings.component.html',
  styleUrl: './repository-warnings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.none]': 'lines().length === 0' }
})
export class RepositoryWarningsComponent {
  readonly details = input.required<RepositoryDetails>();
  /** The page's **Credentials** section, whose dialog the credential fixes open. */
  readonly credentials = input.required<CredentialsInUseComponent>();

  private readonly keyDialogs = inject(KeyDialogsService);
  private readonly git = inject(GitApi);
  private readonly repositories = inject(RepositoriesApi);
  private readonly store = inject(RepositorySettingsStore);
  private readonly toast = inject(ToastService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly transloco = inject(TranslocoService);

  protected readonly headingId = `repo-repository-warnings-heading-${nextId++}`;
  /** The warning whose fix runs, or `null`. */
  private readonly running = signal<RepositoryWarning | null>(null);
  protected readonly lines = computed<WarningLine[]>(() => {
    const running = this.running();
    return this.details().summary.warnings.map(warning => ({
      warning,
      busy: running === warning,
      unavailable: running !== null && running !== warning
    }));
  });

  /** Runs the fix of `warning`; nothing while another runs. */
  protected async fix(warning: RepositoryWarning): Promise<void> {
    if (this.running() !== null) {
      return;
    }
    this.running.set(warning);
    const id = this.details().summary.id;
    // As the problems were when the fix started: the fix itself may change them.
    const pushCode = PUSH_CODES[warning];
    const pushHeld = pushCode !== undefined && this.details().remoteProblems.push?.code === pushCode;
    try {
      if (!await this.runFix(warning)) {
        return;
      }
      if (FETCH_AFTER.has(warning)) {
        await this.fetch(id);
      }
      if (pushHeld) {
        this.notify('pushToClear', 'info');
      }
    } finally {
      this.running.set(null);
    }
  }

  /** True when the fix was made. */
  private async runFix(warning: RepositoryWarning): Promise<boolean> {
    switch (warning) {
      case 'credentials-refused':
        return this.credentials().change({ hint: 'refused-key', offerTokenUpdate: true });
      case 'cannot-push':
        return this.credentials().change({});
      case 'host-key-changed':
        return this.reviewHostKey();
      case 'key-locked':
        return this.unlock();
    }
  }

  /**
   * The changed host key dialog with the keys of the stored problem (RC-21):
   * the last fetch's or pull's, else the last push's. True once the new key is
   * trusted, or on **Try again** when there was no new key to trust. When the
   * stored problem does not describe the key, such as when it changed since
   * the page read it, a fetch meets the changed key again and stores it: the
   * page reads it, and a notice asks to try again.
   */
  private async reviewHostKey(): Promise<boolean> {
    const { fetch, push } = this.details().remoteProblems;
    const problem = [ fetch, push ].find(stored => stored?.code === 'host-key-changed');
    const reviewed = await this.keyDialogs.reviewHostKey(problem?.params);
    if (reviewed === null) {
      this.notify('keyUnknown', 'warning');
      await this.fetch(this.details().summary.id);
      this.store.reload();
      return false;
    }
    return reviewed;
  }

  /**
   * Asks for the passphrase of the repository's key (RC-16), whose name, type
   * and fingerprint the dialog shows, so the credentials in use are read
   * first. A key unlocked meanwhile, such as in another tab, needs nothing.
   */
  private async unlock(): Promise<boolean> {
    let found: ProtectedKey | null;
    try {
      found = protectedKeyOf(await firstValueFrom(this.repositories.repositoryCredentials(this.details().summary.id)));
    } catch (error) {
      this.toast.show({
        message: this.errorText.describe(toApiError(error)).text,
        dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
        status: 'danger'
      });
      return false;
    }
    if (found === null) {
      // Not a locked key any more: the store shows what the repository has now.
      this.store.reload();
      return false;
    }
    return found.unlocked || this.keyDialogs.unlock(found.key);
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

  private notify(message: string, status: Status): void {
    this.toast.show({
      message: this.transloco.translate(`${KEY}.${message}`),
      dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
      status
    });
  }
}
