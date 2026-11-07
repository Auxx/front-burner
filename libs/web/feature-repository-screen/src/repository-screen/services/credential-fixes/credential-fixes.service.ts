import { inject, Injectable } from '@angular/core';
import { type ChangedHostKey, ChangedHostKeySchema, HostKeySchema } from '@front-burner/shared-contracts';
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

import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { LockedKeyService } from '../locked-key/locked-key.service';
import { type PushProblem, PushService } from '../push/push.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

/**
 * The one place that connects the fix of a push problem (RC-4) to what it
 * does: **Try again** and **Unlock** run through `PushService`; **Add
 * credentials**, **Fix credentials** and **Use other credentials** open the
 * repository credentials dialog (RC-7), and once it saved, the push runs again
 * on its own (RC-9). **Cancel** changes nothing, and the problem stays.
 * Refused credentials offer to update the token of saved HTTPS credentials,
 * and a refused key gets RC-14's hint: the dialog shows whichever fits the
 * credentials in use (RC-12, RC-14).
 *
 * **Review the new key** opens the changed host key dialog with the keys from
 * the push's error; once the new key is trusted, or on its **Try again**, the
 * push runs again (RC-21, RC-22). A push that meets an unknown host, such as
 * after the user's known hosts were lost, asks to trust it as on the Add
 * repository page (AR-32), then runs again. Provided by the page.
 */
@Injectable()
export class CredentialFixesService {
  private readonly dialogs = inject(DialogService);
  private readonly pushes = inject(PushService);
  private readonly lockedKey = inject(LockedKeyService);
  private readonly session = inject(RepositorySessionService);
  private readonly store = inject(GitStatusStore);
  private readonly hostTrust = inject(HostTrustService);
  private readonly toast = inject(ToastService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly transloco = inject(TranslocoService);

  async run(fix: PushProblem['fix']): Promise<void> {
    switch (fix) {
      case 'retry':
        return this.pushes.retry();
      case 'unlock':
        return this.pushes.unlockAndRetry();
      case 'add-credentials':
      case 'other-credentials':
        return this.replaceCredentials({});
      case 'fix-credentials':
        return this.replaceCredentials({ hint: 'refused-key', offerTokenUpdate: true });
      case 'review-host-key':
        return this.reviewHostKey();
      case 'trust-host':
        return this.trustHost();
      default:
        return undefined;
    }
  }

  private async replaceCredentials(options: Omit<RepositoryCredentialsDialogData, 'repository'>): Promise<void> {
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
    await this.pushes.retry();
  }

  private async reviewHostKey(): Promise<void> {
    const parsed = ChangedHostKeySchema.safeParse(this.pushes.problem()?.params);
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
      await this.pushes.retry();
    }
  }

  private async trustHost(): Promise<void> {
    const parsed = HostKeySchema.safeParse(this.pushes.problem()?.params);
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
      await this.pushes.retry();
    }
  }
}
