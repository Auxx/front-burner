import { computed, inject, Injectable, signal, type Type } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { ApiError, GitResolution } from '@front-burner/shared-contracts';
import { DialogService, ToastService } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { toApiError } from '@front-burner/web-core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, type Observable } from 'rxjs';

import { AbortMergeDialog } from '../../dialogs/abort-merge/abort-merge.dialog';
import {
  type CommitMergeData,
  CommitMergeDialog,
  type CommitMergeOutcome
} from '../../dialogs/commit-merge/commit-merge.dialog';
import { MarkersLeftDialog } from '../../dialogs/markers-left/markers-left.dialog';
import { StartOverDialog } from '../../dialogs/start-over/start-over.dialog';
import { UndoMergeDialog } from '../../dialogs/undo-merge/undo-merge.dialog';
import type { ConflictAction } from '../../models/conflict-action.model';
import { CommitAuthorGate } from '../commit-author-gate/commit-author-gate.service';
import { DiskChangesService } from '../disk-changes/disk-changes.service';
import { EntryCommandsService, OWN_CHANGE_MS } from '../entry-commands/entry-commands.service';
import { FailureToastService } from '../failure-toast/failure-toast.service';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { MergeStore } from '../merge-store/merge-store.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

const KEY = 'web-feature-repository-screen.MergeActionsService';

/**
 * How a change to the merge ended: it went through, it stopped (failed, said why,
 * or the repository changed meanwhile), or it was refused with a code the caller
 * deals with.
 */
type ChangeOutcome = 'changed' | 'stopped' | 'quiet';

/**
 * Answers to a resolve that count as done: the file was resolved meanwhile, by a
 * second press or on another device, or the merge ended.
 */
const RESOLVED = [ 'not-conflicting', 'no-merge-in-progress' ];

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
  private readonly failures = inject(FailureToastService);
  private readonly gate = inject(CommitAuthorGate);
  private readonly diskChanges = inject(DiskChangesService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  private readonly abortRunning = signal(false);
  private readonly undoRunning = signal(false);
  private readonly resolveRunning = signal<{ path: string; resolution: ConflictAction; } | null>(null);
  private asking = false;
  /** Settles when the last resolve has ended; it never rejects. */
  private resolveSettled: Promise<void> = Promise.resolve();

  /** Whether an abort the user confirmed is running. */
  readonly aborting = this.abortRunning.asReadonly();
  /** Whether an undo the user confirmed is running. */
  readonly undoing = this.undoRunning.asReadonly();
  /** The resolve running, if any. */
  readonly resolving = this.resolveRunning.asReadonly();

  /** Asks, then aborts the merge. Settles when it has ended, whatever the outcome. */
  async abort(): Promise<void> {
    const repositoryId = this.session.repository()?.id;
    if (repositoryId === undefined || this.asking || this.abortRunning()) {
      return;
    }
    const confirmed = await this.ask(AbortMergeDialog);
    if (!confirmed || !this.stillOn(repositoryId)) {
      return;
    }
    this.abortRunning.set(true);
    try {
      // A resolve that fails gives its file's saves back, which must happen before the abort drops them.
      await this.resolveSettled;
      if (!this.stillOn(repositoryId)) {
        return;
      }
      await this.send(repositoryId);
    } finally {
      this.abortRunning.set(false);
    }
  }

  /**
   * Resolves the conflicting file at `path` with a whole version, or keeps or
   * deletes it, at once (GC-15, GC-16), as **Abort merge** does to every
   * conflicting file from step 3 on, so that no waiting save of the file lands
   * after it. Then the merge is read again, which moves the selection on (GC-8).
   * `not-conflicting` is no failure: the file was resolved meanwhile, by a second
   * press or on another device, and neither is `no-merge-in-progress`. Ignored
   * while an abort or another resolve runs; an abort confirmed meanwhile waits
   * for it, so that the saves a failed resolve gives back are dropped too.
   * Settles when it has ended, whatever the outcome.
   */
  async resolve(path: string, resolution: GitResolution): Promise<void> {
    const repositoryId = this.idleOn();
    if (repositoryId !== null) {
      await this.run(path, resolution, () => this.sendResolve(repositoryId, path, resolution));
    }
  }

  /**
   * **Mark as resolved** (GC-14): the file's waiting save is sent first, so that
   * what is marked is what the user sees, and a save that fails stops it with the
   * reason. The backend decides whether markers are left: on
   * `conflict-markers-left` the file's saves are given back, and the user is asked
   * whether to mark it as resolved anyway; once confirmed, it is sent again with
   * `force`. Otherwise as `resolve`, whose rules it shares.
   */
  async markResolved(path: string): Promise<void> {
    const repositoryId = this.idleOn();
    if (repositoryId !== null) {
      await this.run(path, 'mark-resolved', () => this.sendMarkResolved(repositoryId, path));
    }
  }

  /**
   * **Start over** (GC-18): puts the resolved file at `path` back as it was when
   * the merge stopped, with its conflict markers. It asks first when the user
   * edited it, or when the merge has not been read; a whole version is started
   * over at once. Its waiting save and browser draft are dropped, as the user
   * asked for it, and an open file is loaded again, as `resolve` does (GA-24).
   * `not-resolved` is no failure: it was started over meanwhile. Otherwise as
   * `resolve`, whose rules it shares.
   */
  async startOver(path: string): Promise<void> {
    const repositoryId = this.idleOn();
    if (repositoryId === null) {
      return;
    }
    const edited = this.store.state()?.files.find(file => file.path === path)?.edited ?? true;
    // The question takes time: what was free before it, or the repository, may have changed after it.
    if (edited && (!(await this.ask(StartOverDialog)) || this.idleOn() !== repositoryId)) {
      return;
    }
    await this.run(path, 'start-over', async () => {
      await this.changeOne(
        repositoryId,
        path,
        () => this.api.startConflictOver(repositoryId, { path }),
        [ 'not-resolved', 'no-merge-in-progress' ]
      );
    });
  }

  /**
   * **Commit merge** (GC-20, GC-21): opens the dialog with git's message, once
   * every file is resolved. Each press asks `CommitAuthorGate` first (CA-12):
   * cancelling there leaves the merge, and the dialog, as they were. The backend
   * commits; then the status and the merge are read again, and the screen returns
   * to normal. `no-merge-in-progress` is no failure: the merge ended elsewhere, and
   * the dialog closes, as it does when that is seen any other way. Any other
   * failure is the dialog's to show (GC-27), and `merge-unresolved` also reads the
   * merge again, so that the file reopened elsewhere shows. Ignored while anything
   * else is asked or running. Settles when the dialog has closed.
   */
  async commit(): Promise<void> {
    const repositoryId = this.idleOn();
    const state = this.store.state();
    if (repositoryId === null || state === null || state.files.some(file => !file.resolved)) {
      return;
    }
    this.asking = true;
    try {
      const ref = this.dialogs.open<CommitMergeDialog, CommitMergeData, void>(CommitMergeDialog, {
        data: {
          message: state.message,
          author: this.gate.author,
          authorFailed: this.gate.readFailed,
          ended: computed(() => !this.store.merging() || !this.stillOn(repositoryId)),
          changeAuthor: () => this.gate.change(),
          commit: message => this.sendCommit(repositoryId, message)
        }
      });
      await firstValueFrom(ref.closed, { defaultValue: undefined });
    } finally {
      this.asking = false;
    }
  }

  /**
   * **Undo merge** (GC-25, GC-26), from the merge-committed notice or the branch
   * list. It asks first. Then, as a branch switch does:
   *
   * 1. the waiting saves are sent, as the backend refuses with uncommitted
   *    changes, and a save that lands after the reset would bring the merge's
   *    content back. One that did not reach the disk stops it and says why;
   * 2. every saver is held, so that an edit typed meanwhile waits;
   * 3. the backend decides whether the merge can still be undone, and undoes it;
   * 4. the open file is compared with the disk, which reloads it or asks (ED-24),
   *    before the savers are released. The event may not come, or come too late.
   *
   * A toast says "Merge undone.", or why it failed (GC-27), such as when the merge
   * commit was pushed meanwhile (`undo-not-allowed`). Either way the status is read
   * again, which brings the **to pull** count back, or takes the stale button away.
   * Ignored while anything else is asked or running. Settles when it has ended.
   */
  async undo(): Promise<void> {
    const repositoryId = this.idleOn();
    if (repositoryId === null || !(await this.ask(UndoMergeDialog)) || this.idleOn() !== repositoryId) {
      return;
    }
    this.undoRunning.set(true);
    try {
      await this.sendUndo(repositoryId);
    } finally {
      this.undoRunning.set(false);
    }
  }

  private async sendUndo(repositoryId: number): Promise<void> {
    const notSaved = await this.openFiles.flushed(repositoryId);
    if (!this.stillOn(repositoryId)) {
      return;
    }
    if (notSaved !== null) {
      this.failures.show(notSaved.error);
      return;
    }
    const release = this.openFiles.hold();
    let failure: ApiError | null = null;
    try {
      await firstValueFrom(this.api.undoMerge(repositoryId), { defaultValue: undefined });
    } catch (error) {
      failure = toApiError(error);
    } finally {
      await this.followOpenFile(repositoryId);
      release();
    }
    if (!this.stillOn(repositoryId)) {
      return;
    }
    if (failure === null) {
      this.toast.show({
        message: this.transloco.translate(`${KEY}.undone`),
        dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
        status: 'success'
      });
    } else {
      this.failures.show(failure);
    }
    await this.status.refresh();
  }

  /** Only the open file can be typed in; the others follow `files.changed` when they are opened. */
  private async followOpenFile(repositoryId: number): Promise<void> {
    const file = this.openFiles.current();
    if (file !== null && this.stillOn(repositoryId)) {
      this.diskChanges.notice(file.path());
      await this.diskChanges.settled();
    }
  }

  /**
   * One press of the dialog's **Commit merge**. An author that can't be read
   * fails like the commit itself, as the commit form does.
   */
  private async sendCommit(repositoryId: number, message: string): Promise<CommitMergeOutcome> {
    try {
      if (!(await this.gate.ready())) {
        return 'cancelled';
      }
      if (!this.stillOn(repositoryId)) {
        return 'ended';
      }
      await firstValueFrom(this.api.commitMerge(repositoryId, { message }));
    } catch (error) {
      const apiError = toApiError(error);
      if (!this.stillOn(repositoryId)) {
        return 'ended';
      }
      if (apiError.code === 'commit-author-not-confirmed') {
        this.gate.refresh();
      }
      await this.readAfterCommit();
      return this.mergeEnded(error) ? 'ended' : { error: apiError };
    }
    await this.readAfterCommit();
    return 'committed';
  }

  /**
   * The status first: once it says that the merge ended, the merge is not read,
   * which would only be refused. Otherwise it is read too, such as for a file
   * reopened elsewhere (`merge-unresolved`).
   */
  private async readAfterCommit(): Promise<void> {
    await this.status.refresh();
    await this.store.refresh();
  }

  /** The open repository, when nothing is asked or running that a resolve must wait for; otherwise `null`. */
  private idleOn(): number | null {
    const repositoryId = this.session.repository()?.id;
    const busy = this.asking || this.abortRunning() || this.undoRunning() || this.resolveRunning() !== null;
    return repositoryId === undefined || busy ? null : repositoryId;
  }

  /** Runs `work` as the one change of a conflicting file, shown by `resolving`, for an abort to wait for. */
  private async run(path: string, resolution: ConflictAction, work: () => Promise<void>): Promise<void> {
    this.resolveRunning.set({ path, resolution });
    const running = work().finally(() => this.resolveRunning.set(null));
    this.resolveSettled = running;
    await running;
  }

  private async sendResolve(repositoryId: number, path: string, resolution: GitResolution): Promise<void> {
    await this.changeOne(
      repositoryId,
      path,
      () => this.api.resolveConflict(repositoryId, { path, resolution }),
      RESOLVED
    );
  }

  private async sendMarkResolved(repositoryId: number, path: string): Promise<void> {
    for (const force of [ false, true ]) {
      if (!(await this.savedFirst(repositoryId, path))) {
        return;
      }
      const outcome = await this.changeOne(
        repositoryId,
        path,
        () =>
          this.api.resolveConflict(repositoryId, { path, resolution: 'mark-resolved', ...(force ? { force } : {}) }),
        RESOLVED,
        force ? [] : [ 'conflict-markers-left' ]
      );
      // Never over another question, nor once an abort is confirmed or the user has left the repository.
      const mayAsk = outcome === 'quiet' && !this.asking && !this.abortRunning() && this.stillOn(repositoryId);
      if (!mayAsk || !(await this.ask(MarkersLeftDialog)) || !this.stillOn(repositoryId)) {
        return;
      }
    }
  }

  /** Sends the waiting saves first; says why and resolves `false` when the file's edits did not get there. */
  private async savedFirst(repositoryId: number, path: string): Promise<boolean> {
    const unsaved = await this.openFiles.flushed(repositoryId, [ path ]);
    if (unsaved !== null) {
      this.failures.show(unsaved.error);
      return false;
    }
    return true;
  }

  /**
   * `change` for the one file at `path`; when it went through, the merge and the
   * status are read again: its own `git.changed` reads them too, but the push
   * channel may be down.
   */
  private async changeOne(
    repositoryId: number,
    path: string,
    request: () => Observable<void>,
    done: readonly string[],
    quiet: readonly string[] = []
  ): Promise<ChangeOutcome> {
    const outcome = await this.change(repositoryId, [ path ], request, done, quiet);
    if (outcome === 'changed') {
      await Promise.all([ this.status.refresh(), this.store.refresh() ]);
    }
    return outcome;
  }

  /**
   * Opens `dialog` and resolves whether the user confirmed; while it is open, an
   * abort is not asked. Callers check `asking` first, so that questions never overlap.
   */
  private async ask(dialog: Type<unknown>): Promise<boolean> {
    this.asking = true;
    try {
      const ref = this.dialogs.open<unknown, void, boolean>(dialog);
      return await firstValueFrom(ref.closed, { defaultValue: undefined }) === true;
    } finally {
      this.asking = false;
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
    const outcome = await this.change(
      repositoryId,
      paths,
      () => this.api.abortMerge(repositoryId),
      [ 'no-merge-in-progress' ]
    );
    if (outcome === 'changed') {
      await this.status.refresh();
    }
  }

  /**
   * Steps 3 to 5 of the abort, for `paths`, around `request`. An answer with one
   * of the `done` codes counts as success. One of the `quiet` codes gives the
   * saves back and resolves `quiet`, for the caller to deal with. Any other
   * failure says why, gives the saves back and reads what is true now. Resolves
   * `changed` when the request went through and the repository is still the one
   * open.
   */
  private async change(
    repositoryId: number,
    paths: readonly string[],
    request: () => Observable<void>,
    done: readonly string[],
    quiet: readonly string[] = []
  ): Promise<ChangeOutcome> {
    const route = this.routePath();
    // Only these can be followed as a change on disk, which this one is not (ED-24, FB-42).
    const shown = paths.filter(path => this.openFiles.get(path) !== undefined || path === route);
    const own = new Map(shown.map(path => [ path, this.commands.ownChange(path) ]));
    // Those with no entry have no save to wait for, and keep their drafts if this fails.
    const notOpen = paths.filter(path => this.openFiles.get(path) === undefined);
    const dropped = await Promise.all(shown.map(path => this.openFiles.dropForDiscard(path)));
    try {
      await firstValueFrom(request(), { defaultValue: undefined });
    } catch (error) {
      const code = toApiError(error).code;
      if (!done.includes(code)) {
        dropped.forEach(file => file?.restore());
        own.forEach(release => release());
        if (quiet.includes(code)) {
          return 'quiet';
        }
        await this.failed(error);
        return 'stopped';
      }
    }
    void this.openFiles.deleteDrafts(repositoryId, notOpen);
    if (!this.stillOn(repositoryId)) {
      // Navigated meanwhile: the entries at these paths are now another repository's.
      dropped.forEach(file => file?.release());
      own.forEach(release => release());
      return 'stopped';
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
    return 'changed';
  }

  /** The conflicting files, read here if the store has not got them. Rejects with what the read answered. */
  private async conflictingPaths(repositoryId: number): Promise<string[]> {
    const state = this.store.state() ?? await firstValueFrom(this.api.gitMerge(repositoryId));
    return state.files.map(file => file.path);
  }

  /** Says why, unless the merge turned out to have ended, and reads what is true now. */
  private async failed(error: unknown): Promise<void> {
    if (!this.mergeEnded(error)) {
      this.failures.show(toApiError(error));
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
}
