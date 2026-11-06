import { inject, Injectable } from '@angular/core';
import { DialogService } from '@front-burner/ui';
import {
  RepositoryCredentialsDialog,
  type RepositoryCredentialsDialogData
} from '@front-burner/web-repository-dialogs';
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
 * on its own (RC-9). **Cancel** changes nothing, and the problem stays. A
 * refused key gets RC-14's hint; plan 64 adds updating saved HTTPS
 * credentials, and plan 66 the changed host key. Provided by the page.
 */
@Injectable()
export class CredentialFixesService {
  private readonly dialogs = inject(DialogService);
  private readonly pushes = inject(PushService);
  private readonly lockedKey = inject(LockedKeyService);
  private readonly session = inject(RepositorySessionService);
  private readonly store = inject(GitStatusStore);

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
        return this.replaceCredentials({ hint: 'refused-key' });
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
    // The new credentials may be a locked key: the banner shows it, and the push asks for it (RC-17).
    await this.lockedKey.reread();
    await this.pushes.retry();
  }
}
