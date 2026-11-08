import { inject, Injectable } from '@angular/core';
import {
  type ChangedHostKey,
  ChangedHostKeySchema,
  type GitNetworkJobType,
  type GitProblemState,
  HostKeySchema
} from '@front-burner/shared-contracts';
import { DialogService, ToastService } from '@front-burner/ui';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import {
  ChangedHostKeyDialog,
  HostNotTrusted,
  HostTrustService,
  RepositoryCredentialsDialog,
  type RepositoryCredentialsDialogData
} from '@front-burner/web-repository-dialogs';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { fetchProblemFix, type GitFix } from '../../utils/git-problem/git-problem';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { LockedKeyService } from '../locked-key/locked-key.service';
import { NetworkJobService } from '../network-job/network-job.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

/**
 * The one place that connects the fix of a network job problem (RC-4) to what it
 * does: **Try again** and **Unlock** run through `NetworkJobService`; **Add
 * credentials**, **Fix credentials** and **Use other credentials** open the
 * repository credentials dialog (RC-7), and once it saved, the failed operation
 * (a push or a fetch) runs again on its own (RC-9). **Cancel** changes nothing, and the problem stays.
 * Refused credentials offer to update the token of saved HTTPS credentials,
 * and a refused key gets RC-14's hint: the dialog shows whichever fits the
 * credentials in use (RC-12, RC-14).
 *
 * **Review the new key** opens the changed host key dialog with the keys from
 * the job's error; once the new key is trusted, or on its **Try again**, the
 * operation runs again (RC-21, RC-22). A job that meets an unknown host, such as
 * after the user's known hosts were lost, asks to trust it as on the Add
 * repository page (AR-32), then runs again. The quiet fetch status has no job
 * to run again: `runFetchFix` takes the problem to fix, and a fetch runs (GA-35,
 * RC-6). Provided by the page.
 */
@Injectable()
export class CredentialFixesService {
  private readonly dialogs = inject(DialogService);
  private readonly jobs = inject(NetworkJobService);
  private readonly lockedKey = inject(LockedKeyService);
  private readonly session = inject(RepositorySessionService);
  private readonly store = inject(GitStatusStore);
  private readonly hostTrust = inject(HostTrustService);
  private readonly toast = inject(ToastService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly transloco = inject(TranslocoService);

  /** Runs `fix`, of the job problem in the banner. */
  async run(fix: GitFix): Promise<void> {
    const problem = this.jobs.problem();
    switch (fix) {
      case 'retry':
        return this.jobs.retry();
      case 'unlock':
        return this.jobs.unlockAndRetry();
      default:
        return this.runDialogFix(fix, problem?.params, problem?.operation);
    }
  }

  /** Runs the fix of `problem`, the last fetch's as the status has it, which may be from before a reload. */
  async runFetchFix(problem: GitProblemState): Promise<void> {
    return this.runDialogFix(fetchProblemFix(problem.code), problem.params, 'fetch');
  }

  private async runDialogFix(
    fix: GitFix,
    params: unknown,
    operation: GitNetworkJobType | undefined
  ): Promise<void> {
    // The operation as of now: a job started while a dialog is open clears the banner's problem.
    const again = () => this.runAgain(operation);
    switch (fix) {
      case 'add-credentials':
      case 'other-credentials':
        return this.replaceCredentials({}, again);
      case 'fix-credentials':
        return this.replaceCredentials({ hint: 'refused-key', offerTokenUpdate: true }, again);
      case 'review-host-key':
        return this.reviewHostKey(params, again);
      case 'trust-host':
        return this.trustHost(params, again);
      default:
        return undefined;
    }
  }

  /**
   * The fixed operation again, after any job that runs now (RC-9). A fix made for
   * a push may also have fixed the last fetch's problem, which only a fetch can
   * clear from the status, so one follows, saying nothing.
   */
  private async runAgain(operation: GitNetworkJobType | undefined): Promise<void> {
    if (operation === undefined) {
      return;
    }
    await this.jobs.startWhenFree(operation);
    if (operation !== 'fetch' && this.store.status()?.fetchProblem) {
      await this.jobs.startWhenFree('fetch', { background: true });
    }
  }

  private async replaceCredentials(
    options: Omit<RepositoryCredentialsDialogData, 'repository'>,
    again: () => Promise<void>
  ): Promise<void> {
    const repository = this.session.repository();
    if (repository === null) {
      return;
    }
    const ref = this.dialogs.open<RepositoryCredentialsDialog, RepositoryCredentialsDialogData, boolean>(
      RepositoryCredentialsDialog,
      { data: { repository, ...options } }
    );
    const saved = await firstValueFrom(ref.closed, { defaultValue: undefined }) === true;
    // Not after a switch to another repository while the dialog was open.
    if (!saved || this.store.followed() !== repository.id) {
      return;
    }
    // The new credentials may be a locked key, for the banner. The push needs no wait for it: it asks
    // for a locked key's passphrase by itself (RC-17).
    void this.lockedKey.reread();
    await again();
  }

  private async reviewHostKey(params: unknown, again: () => Promise<void>): Promise<void> {
    const parsed = ChangedHostKeySchema.safeParse(params);
    if (!parsed.success) {
      return;
    }
    const repositoryId = this.store.followed();
    const ref = this.dialogs.open<ChangedHostKeyDialog, ChangedHostKey, boolean>(ChangedHostKeyDialog, {
      data: parsed.data
    });
    const trusted = await firstValueFrom(ref.closed, { defaultValue: undefined }) === true;
    // Not after a switch to another repository while the dialog was open.
    if (trusted && this.store.followed() === repositoryId) {
      await again();
    }
  }

  private async trustHost(params: unknown, again: () => Promise<void>): Promise<void> {
    const parsed = HostKeySchema.safeParse(params);
    if (!parsed.success) {
      return;
    }
    const repositoryId = this.store.followed();
    try {
      await this.hostTrust.trust(parsed.data);
    } catch (error) {
      if (!(error instanceof HostNotTrusted)) {
        this.toast.show({
          message: this.errorText.describe(toApiError(error)).text,
          dismissLabel: this.transloco.translate('web-feature-repository-screen.CredentialFixesService.dismiss'),
          status: 'danger'
        });
      }
      return;
    }
    if (this.store.followed() === repositoryId) {
      await again();
    }
  }
}
