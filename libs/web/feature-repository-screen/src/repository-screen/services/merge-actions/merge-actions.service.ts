import { inject, Injectable, signal } from '@angular/core';
import { DialogService, ToastService } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { AbortMergeDialog } from '../../dialogs/abort-merge/abort-merge.dialog';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { MergeStore } from '../merge-store/merge-store.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

/**
 * What the user does to the merge in progress. Provided by the page.
 *
 * **Abort merge** (GC-23, GC-24). The order of the steps is what keeps a late
 * save from writing the merge's content over the restored file:
 *
 * 1. the user confirms;
 * 2. each open conflicting file's waiting save and browser draft are dropped,
 *    and a save in flight is waited for;
 * 3. the backend aborts the merge;
 * 4. the drafts of conflicting files not open here are deleted, so that none
 *    offers markers later (ED-25). The open ones then load through the
 *    `files.changed` event, which finds nothing unsaved in them.
 *
 * When the abort fails, a toast says why with its reference, the saves are given
 * back, and the merge stays (GC-27).
 */
@Injectable()
export class MergeActionsService {
  private readonly dialogs = inject(DialogService);
  private readonly api = inject(GitApi);
  private readonly status = inject(GitStatusStore);
  private readonly store = inject(MergeStore);
  private readonly openFiles = inject(OpenFilesService);
  private readonly session = inject(RepositorySessionService);
  private readonly toast = inject(ToastService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly transloco = inject(TranslocoService);

  private readonly abortRunning = signal(false);
  private asking = false;

  /** Whether an abort the user confirmed is running. */
  readonly aborting = this.abortRunning.asReadonly();

  /** Asks, then aborts the merge. Settles when it has ended, whatever the outcome. */
  async abort(): Promise<void> {
    const repositoryId = this.status.followed();
    if (repositoryId === null || this.asking || this.abortRunning()) {
      return;
    }
    this.asking = true;
    let confirmed: boolean;
    try {
      const ref = this.dialogs.open<AbortMergeDialog, void, boolean>(AbortMergeDialog);
      confirmed = await firstValueFrom(ref.closed, { defaultValue: undefined }) === true;
    } finally {
      this.asking = false;
    }
    // Not after a switch to another repository while the dialog was open.
    if (!confirmed || this.status.followed() !== repositoryId) {
      return;
    }
    this.abortRunning.set(true);
    try {
      await this.send(repositoryId);
    } finally {
      this.abortRunning.set(false);
    }
  }

  private async send(repositoryId: number): Promise<void> {
    if (this.store.state() === null) {
      await this.store.refresh();
    }
    // If it still can't be read, which files conflict is not known, and any unsaved one might.
    const paths = this.store.state()?.files.map(file => file.path) ?? this.openFiles.unsavedPaths(repositoryId);
    const notOpen = paths.filter(path => this.openFiles.get(path) === undefined);
    const dropped = await Promise.all(paths.map(path => this.openFiles.dropForDiscard(path)));
    try {
      await firstValueFrom(this.api.abortMerge(repositoryId), { defaultValue: undefined });
    } catch (error) {
      dropped.forEach(file => file?.restore());
      this.showFailure(error);
      await Promise.all([ this.status.refresh(), this.store.refresh() ]);
      return;
    }
    dropped.forEach(file => file?.release());
    void this.openFiles.deleteDrafts(repositoryId, notOpen);
    await this.status.refresh();
  }

  private showFailure(error: unknown): void {
    const { text, reference } = this.errorText.describe(toApiError(error));
    const key = 'web-feature-repository-screen.MergeActionsService';
    this.toast.show({
      message: reference === null ? text : `${text} ${this.transloco.translate(`${key}.reference`, { reference })}`,
      dismissLabel: this.transloco.translate(`${key}.dismiss`),
      status: 'danger'
    });
  }
}
