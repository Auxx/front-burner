import { inject, Injectable } from '@angular/core';
import type { ApiError } from '@front-burner/shared-contracts';
import { type DialogRef, DialogService, ToastService } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, isRefusal, toApiError } from '@front-burner/web-core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, type Observable, Subject } from 'rxjs';

import { type BranchChoice, type BranchListData, BranchListDialog } from '../../dialogs/branch-list/branch-list.dialog';
import { type SwitchRefusedData, SwitchRefusedDialog } from '../../dialogs/switch-refused/switch-refused.dialog';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

const KEY = 'web-feature-repository-screen.BranchActionsService';

/** Their usual text tells how to get a file past a commit, by unticking it, which does not help a switch. */
const NOT_SAVED_TEXTS: ReadonlySet<string> = new Set([ 'file-gone', 'changed-on-disk' ]);

/**
 * The branch list (GA-36) and what its choice does (GA-37). Provided by the page.
 *
 * The waiting saves are sent first (GA-40), so that a save counts as a change and
 * refuses the switch, rather than landing on the other branch. One that did not
 * reach the disk stops the switch and says why. Then the backend decides, as only
 * it can tell inside its lock whether the working copy is clean (GA-39). A refusal
 * reads the status first, since it may not know of the save just sent, and says why
 * with the changed files; **Show changes** tells the page. Any other failure is a
 * toast, with **Try again** for network and server errors (GA-43).
 *
 * The tree, the open file and the status follow a switch through `files.changed`
 * and `git.changed`, also one made in another tab (GA-40).
 */
@Injectable()
export class BranchActionsService {
  private readonly dialogs = inject(DialogService);
  private readonly api = inject(GitApi);
  private readonly status = inject(GitStatusStore);
  private readonly openFiles = inject(OpenFilesService);
  private readonly session = inject(RepositorySessionService);
  private readonly toast = inject(ToastService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly transloco = inject(TranslocoService);
  private readonly changesAsked = new Subject<void>();

  /** The branch list while it is open. */
  private list: DialogRef<BranchChoice> | null = null;
  private switching = false;

  /** **Show changes** was chosen: the page opens **Changes** (GA-39). */
  readonly showChanges: Observable<void> = this.changesAsked.asObservable();

  /** Opens the list and acts on the choice. Settles when that has ended, whatever the outcome. */
  async open(): Promise<void> {
    const repositoryId = this.session.repository()?.id;
    if (repositoryId === undefined || this.list !== null || this.switching) {
      return;
    }
    const ref = this.dialogs.open<BranchListDialog, BranchListData, BranchChoice>(BranchListDialog, {
      data: { repositoryId }
    });
    this.list = ref;
    const choice = await firstValueFrom(ref.closed, { defaultValue: undefined });
    this.list = null;
    if (choice && this.stillOn(repositoryId)) {
      await this.switchTo(repositoryId, choice);
    }
  }

  /** Closes the list if it is open, such as when a merge starts; `true` when it was. */
  closeList(): boolean {
    if (this.list === null) {
      return false;
    }
    this.list.close();
    this.list = null;
    return true;
  }

  private async switchTo(repositoryId: number, choice: BranchChoice): Promise<void> {
    this.switching = true;
    try {
      await this.openFiles.flushAll();
      if (!this.stillOn(repositoryId)) {
        return;
      }
      const notSaved = this.openFiles.notSaved(repositoryId, this.openFiles.unsavedPaths(repositoryId));
      if (notSaved !== null) {
        this.showFailure(notSaved.error, notSaved.retry, repositoryId, choice);
        return;
      }
      await firstValueFrom(
        this.api.switchBranch(repositoryId, { name: choice.name, remote: choice.kind === 'remote' }),
        { defaultValue: undefined }
      );
      await this.status.refresh();
    } catch (error) {
      await this.failed(error, repositoryId, choice);
    } finally {
      this.switching = false;
    }
  }

  private async failed(error: unknown, repositoryId: number, choice: BranchChoice): Promise<void> {
    if (!this.stillOn(repositoryId)) {
      return;
    }
    const apiError = toApiError(error);
    if (apiError.code !== 'switch-uncommitted-changes') {
      this.showFailure(apiError, !isRefusal(error), repositoryId, choice);
    }
    await this.status.refresh();
    if (apiError.code === 'switch-uncommitted-changes' && this.stillOn(repositoryId)) {
      await this.showRefusal();
    }
  }

  private async showRefusal(): Promise<void> {
    const paths = this.status.status()?.changes.map(change => change.path) ?? [];
    const ref = this.dialogs.open<SwitchRefusedDialog, SwitchRefusedData, boolean>(SwitchRefusedDialog, {
      data: { paths }
    });
    if (await firstValueFrom(ref.closed, { defaultValue: undefined }) === true) {
      this.changesAsked.next();
    }
  }

  private showFailure(error: ApiError, retry: boolean, repositoryId: number, choice: BranchChoice): void {
    this.toast.show({
      message: this.failureText(error),
      dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
      status: 'danger',
      ...(retry
        ? {
          actions: [ {
            label: this.transloco.translate(`${KEY}.retry`),
            run: () => void this.tryAgain(repositoryId, choice)
          } ]
        }
        : {})
    });
  }

  private failureText(error: ApiError): string {
    if (NOT_SAVED_TEXTS.has(error.code)) {
      return this.transloco.translate(`${KEY}.${error.code}`, error.params);
    }
    const { text, reference } = this.errorText.describe(error);
    return reference === null ? text : `${text} ${this.transloco.translate(`${KEY}.reference`, { reference })}`;
  }

  /** The toast stays until it is dismissed, so another repository may be open by now, or another switch running. */
  private async tryAgain(repositoryId: number, choice: BranchChoice): Promise<void> {
    if (this.stillOn(repositoryId) && !this.switching && this.list === null) {
      await this.switchTo(repositoryId, choice);
    }
  }

  private stillOn(repositoryId: number): boolean {
    return this.session.repository()?.id === repositoryId;
  }
}
