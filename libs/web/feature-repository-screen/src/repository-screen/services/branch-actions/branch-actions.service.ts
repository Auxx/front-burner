import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import type { ApiError } from '@front-burner/shared-contracts';
import { type DialogRef, DialogService, type ToastAction } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { isRefusal, toApiError } from '@front-burner/web-core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, type Observable, Subject } from 'rxjs';

import { type BranchChoice, type BranchListData, BranchListDialog } from '../../dialogs/branch-list/branch-list.dialog';
import { type SwitchRefusedData, SwitchRefusedDialog } from '../../dialogs/switch-refused/switch-refused.dialog';
import { DiskChangesService } from '../disk-changes/disk-changes.service';
import { FailureToastService } from '../failure-toast/failure-toast.service';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

const KEY = 'web-feature-repository-screen.BranchActionsService';

/** Their usual text tells how to get a file past a commit, by unticking it, which does not help a switch. */
const NOT_SAVED_TEXTS: ReadonlySet<string> = new Set([ 'file-gone', 'changed-on-disk' ]);

/**
 * The branch list (GA-36) and what its choice does (GA-37). Provided by the page.
 * The order of the steps is what keeps edits from landing on the other branch:
 *
 * 1. the waiting saves are sent (GA-40), so that a save counts as a change and
 *    refuses the switch. One that did not reach the disk stops the switch and says
 *    why, and so does a browser draft on offer, whose file is about to change;
 * 2. every saver is held, as a save carries no base and would overwrite the other
 *    branch's file. The editor stays editable, so an edit can still arrive;
 * 3. the backend switches, as only it can tell inside its lock whether the working
 *    copy is clean (GA-39);
 * 4. an open file with such an edit is compared with the disk, which asks the user
 *    if it changed (ED-24), before the savers are released. Waiting for the event
 *    would leave time for the edit's save to go first.
 *
 * A refusal reads the status first, as it may not know of the save just sent, and
 * says why with the changed files; **Show changes** tells the page. Any other
 * failure is a toast, with **Try again** for network and server errors (GA-43),
 * which first reads where the branch is, since an answer that got lost may have
 * been a success. The toast goes when another attempt starts, when another
 * repository opens and when the screen is left, so that it can't start an old switch.
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
  private readonly diskChanges = inject(DiskChangesService);
  private readonly session = inject(RepositorySessionService);
  private readonly failures = inject(FailureToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly changesAsked = new Subject<void>();
  private readonly running = signal(false);

  /** The branch list while it is open. */
  private list: DialogRef<BranchChoice> | null = null;
  /** The toast of the last failure, which stays while it offers **Try again**. */
  private failure: { dismiss(): void; } | null = null;
  private destroyed = false;

  /** **Show changes** was chosen: the page opens **Changes** (GA-39). */
  readonly showChanges: Observable<void> = this.changesAsked.asObservable();
  /** Whether a switch is on its way: the bar says so, and offers no other git action. */
  readonly switching = this.running.asReadonly();

  constructor() {
    const repositoryId = computed(() => this.session.repository()?.id);
    effect(() => {
      repositoryId();
      untracked(() => this.dismissFailure());
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.dismissFailure();
    });
  }

  /** Opens the list and acts on the choice. Settles when that has ended, whatever the outcome. */
  async open(): Promise<void> {
    const repositoryId = this.session.repository()?.id;
    if (repositoryId === undefined || this.list !== null || this.running()) {
      return;
    }
    this.dismissFailure();
    const ref = this.dialogs.open<BranchListDialog, BranchListData, BranchChoice>(BranchListDialog, {
      data: { repositoryId }
    });
    this.list = ref;
    const choice = await firstValueFrom(ref.closed, { defaultValue: undefined });
    this.list = null;
    if (choice && this.stillOn(repositoryId)) {
      await this.switchTo(repositoryId, choice, false);
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

  private async switchTo(repositoryId: number, choice: BranchChoice, again: boolean): Promise<void> {
    this.dismissFailure();
    this.running.set(true);
    let refusal: SwitchRefusedData | null;
    try {
      refusal = await this.attempt(repositoryId, choice, again);
    } finally {
      this.running.set(false);
    }
    if (refusal !== null) {
      await this.showRefusal(refusal);
    }
  }

  /** Tries to switch; what to say when the backend refuses because of changes, or else `null`. */
  private async attempt(
    repositoryId: number,
    choice: BranchChoice,
    again: boolean
  ): Promise<SwitchRefusedData | null> {
    try {
      const target = again ? await this.whatIsLeft(repositoryId, choice) : choice;
      if (target === null) {
        return null;
      }
      const notSaved = await this.openFiles.flushed(repositoryId);
      if (!this.stillOn(repositoryId)) {
        return null;
      }
      if (notSaved !== null) {
        this.showFailure(notSaved.error, notSaved.retry, repositoryId, choice);
        return null;
      }
      const offered = this.openFiles.offeredDraft(repositoryId);
      if (offered !== null) {
        const params = { path: offered };
        this.showFailure({ code: 'draft-offered', params, requestId: '', message: '' }, false, repositoryId, choice);
        return null;
      }
      await this.send(repositoryId, target);
    } catch (error) {
      if (this.stillOn(repositoryId)) {
        const apiError = toApiError(error);
        if (apiError.code === 'switch-uncommitted-changes') {
          return this.refusalData(repositoryId);
        }
        this.showFailure(apiError, !isRefusal(error), repositoryId, choice);
      }
    }
    return null;
  }

  /** The switch that is still to do: an answer that got lost may have been a success, which a repeat would refuse. */
  private async whatIsLeft(repositoryId: number, choice: BranchChoice): Promise<BranchChoice | null> {
    const branches = await firstValueFrom(this.api.gitBranches(repositoryId));
    if (branches.current === choice.name) {
      return null;
    }
    return branches.local.some(branch => branch.name === choice.name)
      ? { kind: 'local', name: choice.name }
      : choice;
  }

  private async send(repositoryId: number, choice: BranchChoice): Promise<void> {
    const release = this.openFiles.hold();
    try {
      await firstValueFrom(
        this.api.switchBranch(repositoryId, { name: choice.name, remote: choice.kind === 'remote' }),
        { defaultValue: undefined }
      );
    } finally {
      await this.followEditOfOpenFile(repositoryId);
      release();
    }
  }

  /** Only the open file can be typed in, so only it can have an edit that came after the saves were sent. */
  private async followEditOfOpenFile(repositoryId: number): Promise<void> {
    const file = this.openFiles.current();
    if (file !== null && file.saver.unsaved() && this.stillOn(repositoryId)) {
      this.diskChanges.notice(file.path());
      await this.diskChanges.settled();
    }
  }

  /** The changed files, or `null` when they can't be known. */
  private async refusalData(repositoryId: number): Promise<SwitchRefusedData | null> {
    const read = await this.status.readFresh();
    if (!this.stillOn(repositoryId)) {
      return null;
    }
    const changes = read ? this.status.status()?.changes : undefined;
    return { paths: changes?.map(change => change.path) ?? null };
  }

  private async showRefusal(data: SwitchRefusedData): Promise<void> {
    const ref = this.dialogs.open<SwitchRefusedDialog, SwitchRefusedData, boolean>(SwitchRefusedDialog, { data });
    if (await firstValueFrom(ref.closed, { defaultValue: undefined }) === true) {
      this.changesAsked.next();
    }
  }

  private showFailure(error: ApiError, retry: boolean, repositoryId: number, choice: BranchChoice): void {
    const actions: readonly ToastAction[] = retry
      ? [ {
        label: this.transloco.translate(`${KEY}.retry`),
        run: () => void this.tryAgain(repositoryId, choice)
      } ]
      : [];
    const text = NOT_SAVED_TEXTS.has(error.code)
      ? this.transloco.translate(`${KEY}.${error.code}`, error.params)
      : undefined;
    this.failure = this.failures.show(error, { actions, text, key: `${KEY}.failure` });
  }

  private async tryAgain(repositoryId: number, choice: BranchChoice): Promise<void> {
    if (this.stillOn(repositoryId) && !this.running()) {
      await this.switchTo(repositoryId, choice, true);
    }
  }

  private dismissFailure(): void {
    this.failure?.dismiss();
    this.failure = null;
  }

  /** The session keeps its repository when the screen is left, so that alone doesn't say that the user is still here. */
  private stillOn(repositoryId: number): boolean {
    return !this.destroyed && this.session.repository()?.id === repositoryId;
  }
}
