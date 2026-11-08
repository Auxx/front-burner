import { inject, Injectable, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DialogService, ToastService } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { AbortMergeDialog } from '../../dialogs/abort-merge/abort-merge.dialog';
import { EntryCommandsService, OWN_CHANGE_MS } from '../entry-commands/entry-commands.service';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { MergeStore } from '../merge-store/merge-store.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

/**
 * What the user does to the merge in progress. Provided by the page.
 *
 * **Abort merge** (GC-23, GC-24) follows `DiscardService`, as the order of the
 * steps is what keeps a late save from writing the merge's content over the
 * restored file:
 *
 * 1. the user confirms;
 * 2. the conflicting files are known, from the store or a read. Without them the
 *    abort is refused with the reason, since it can't tell which edits to drop;
 * 3. they count as this tab's own change, so that the abort's events are not taken
 *    for changes made elsewhere (ED-24), and each open one's waiting save and
 *    browser draft are dropped, and a save in flight is waited for;
 * 4. the backend aborts the merge;
 * 5. an open file is loaded again, or waits for **Reload** if that fails, and the
 *    drafts of files not open here are deleted, so that none offers markers later
 *    (ED-25).
 *
 * When the abort fails, a toast says why with its reference, the saves are given
 * back, and the merge stays (GC-27). `no-merge-in-progress` is no failure: the
 * merge ended elsewhere, so the files are as after an abort, and step 5 follows.
 */
@Injectable()
export class MergeActionsService {
  private readonly dialogs = inject(DialogService);
  private readonly api = inject(GitApi);
  private readonly status = inject(GitStatusStore);
  private readonly store = inject(MergeStore);
  private readonly openFiles = inject(OpenFilesService);
  private readonly commands = inject(EntryCommandsService);
  private readonly session = inject(RepositorySessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly transloco = inject(TranslocoService);

  private readonly abortRunning = signal(false);
  private asking = false;

  /** Whether an abort the user confirmed is running. */
  readonly aborting = this.abortRunning.asReadonly();

  /** Asks, then aborts the merge. Settles when it has ended, whatever the outcome. */
  async abort(): Promise<void> {
    const repositoryId = this.session.repository()?.id;
    if (repositoryId === undefined || this.asking || this.abortRunning()) {
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
    if (!confirmed || !this.stillOn(repositoryId)) {
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
    let paths: string[];
    try {
      paths = await this.conflictingPaths(repositoryId);
    } catch (error) {
      await this.failed(error);
      return;
    }
    if (!this.stillOn(repositoryId)) {
      return;
    }
    const route = this.routePath();
    // Only these can be followed as a change on disk, which this one is not (ED-24, FB-42).
    const shown = paths.filter(path => this.openFiles.get(path) !== undefined || path === route);
    const own = new Map(shown.map(path => [ path, this.commands.ownChange(path) ]));
    // Those with no entry have no save to wait for, and keep their drafts if this fails.
    const notOpen = paths.filter(path => this.openFiles.get(path) === undefined);
    const dropped = await Promise.all(shown.map(path => this.openFiles.dropForDiscard(path)));
    try {
      await firstValueFrom(this.api.abortMerge(repositoryId), { defaultValue: undefined });
    } catch (error) {
      if (!this.mergeEnded(error)) {
        dropped.forEach(file => file?.restore());
        own.forEach(release => release());
        await this.failed(error);
        return;
      }
    }
    void this.openFiles.deleteDrafts(repositoryId, notOpen);
    if (!this.stillOn(repositoryId)) {
      // Navigated meanwhile: the entries at these paths are now another repository's.
      dropped.forEach(file => file?.release());
      own.forEach(release => release());
      return;
    }
    await Promise.all(shown.map(async (path, index) => {
      const release = own.get(path) as () => void;
      const reloaded = await this.openFiles.reloadDropped(path);
      dropped[index]?.release();
      if (reloaded) {
        setTimeout(release, OWN_CHANGE_MS);
      } else {
        // Later events may find the new content.
        release();
      }
    }));
    await this.status.refresh();
  }

  /** The conflicting files, read here if the store has not got them. Rejects with what the read answered. */
  private async conflictingPaths(repositoryId: number): Promise<string[]> {
    const state = this.store.state() ?? await firstValueFrom(this.api.gitMerge(repositoryId));
    return state.files.map(file => file.path);
  }

  /** Says why, unless the merge turned out to have ended, and reads what is true now. */
  private async failed(error: unknown): Promise<void> {
    if (!this.mergeEnded(error)) {
      this.showFailure(error);
    }
    await Promise.all([ this.status.refresh(), this.store.refresh() ]);
  }

  private mergeEnded(error: unknown): boolean {
    return toApiError(error).code === 'no-merge-in-progress';
  }

  private stillOn(repositoryId: number): boolean {
    return this.session.repository()?.id === repositoryId;
  }

  private routePath(): string {
    return this.route.snapshot.paramMap.get('path') ?? '';
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
