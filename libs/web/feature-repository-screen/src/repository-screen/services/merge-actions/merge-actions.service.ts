import { inject, Injectable, signal, type Type } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { GitResolution } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { toApiError } from '@front-burner/web-core';
import { firstValueFrom, type Observable } from 'rxjs';

import { AbortMergeDialog } from '../../dialogs/abort-merge/abort-merge.dialog';
import { MarkersLeftDialog } from '../../dialogs/markers-left/markers-left.dialog';
import { EntryCommandsService, OWN_CHANGE_MS } from '../entry-commands/entry-commands.service';
import { FailureToastService } from '../failure-toast/failure-toast.service';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { MergeStore } from '../merge-store/merge-store.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

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

  private readonly abortRunning = signal(false);
  private readonly resolveRunning = signal<{ path: string; resolution: GitResolution; } | null>(null);
  private asking = false;
  /** Settles when the last resolve has ended; it never rejects. */
  private resolveSettled: Promise<void> = Promise.resolve();

  /** Whether an abort the user confirmed is running. */
  readonly aborting = this.abortRunning.asReadonly();
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
    const repositoryId = this.session.repository()?.id;
    if (repositoryId === undefined || this.asking || this.abortRunning() || this.resolveRunning() !== null) {
      return;
    }
    this.resolveRunning.set({ path, resolution });
    const running = this.sendResolve(repositoryId, path, resolution);
    this.resolveSettled = running;
    await running;
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
    const repositoryId = this.session.repository()?.id;
    if (repositoryId === undefined || this.asking || this.abortRunning() || this.resolveRunning() !== null) {
      return;
    }
    this.resolveRunning.set({ path, resolution: 'mark-resolved' });
    const running = this.sendMarkResolved(repositoryId, path);
    this.resolveSettled = running;
    await running;
  }

  private async sendResolve(repositoryId: number, path: string, resolution: GitResolution): Promise<void> {
    try {
      const outcome = await this.change(
        repositoryId,
        [ path ],
        () => this.api.resolveConflict(repositoryId, { path, resolution }),
        RESOLVED
      );
      await this.resolved(outcome);
    } finally {
      this.resolveRunning.set(null);
    }
  }

  private async sendMarkResolved(repositoryId: number, path: string): Promise<void> {
    try {
      for (const force of [ false, true ]) {
        if (!(await this.savedFirst(repositoryId, path))) {
          return;
        }
        const outcome = await this.change(
          repositoryId,
          [ path ],
          () =>
            this.api.resolveConflict(repositoryId, { path, resolution: 'mark-resolved', ...(force ? { force } : {}) }),
          RESOLVED,
          force ? [] : [ 'conflict-markers-left' ]
        );
        if (outcome !== 'quiet') {
          await this.resolved(outcome);
          return;
        }
        if (!(await this.ask(MarkersLeftDialog)) || !this.stillOn(repositoryId)) {
          return;
        }
      }
    } finally {
      this.resolveRunning.set(null);
    }
  }

  /** Sends the waiting save of the file at `path`, if open; says why and resolves `false` when it did not get there. */
  private async savedFirst(repositoryId: number, path: string): Promise<boolean> {
    await this.openFiles.get(path)?.saver.flush();
    const unsaved = this.openFiles.notSaved(repositoryId, [ path ]);
    if (unsaved !== null) {
      this.failures.show(unsaved.error);
      return false;
    }
    return true;
  }

  /** After a resolve: its own `git.changed` reads the merge too, but the push channel may be down. */
  private async resolved(outcome: ChangeOutcome): Promise<void> {
    if (outcome === 'changed') {
      await Promise.all([ this.status.refresh(), this.store.refresh() ]);
    }
  }

  /** Opens `dialog` and resolves whether the user confirmed; while it is open, an abort is not asked. */
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
