import { DestroyRef, inject, Injectable } from '@angular/core';
import { ToastService } from '@front-burner/ui';
import { FilesApi } from '@front-burner/web-api-client';
import { toApiError } from '@front-burner/web-core';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom, type Observable, Subject } from 'rxjs';

import { EntryCommandsService } from '../entry-commands/entry-commands.service';
import { type OpenFile, OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

const KEY = 'web-feature-repository-screen.DiskChangesService';

/** How the open file differs from its last load or save: other content on disk, or no file at all. */
export type DiskChange = { kind: 'changed'; hash: string; } | { kind: 'gone'; };

/**
 * Finds changes to open files made on disk elsewhere — another tab, another
 * device or a git operation (ED-23) — and has `OpenFilesService` follow them
 * (ED-21, ED-24, FB-42). Provided by the page.
 *
 * `TreeSyncService` calls `notice` for the open file when a `files.changed`
 * event may concern it, and a save refused because the file does not exist
 * counts as the file gone. Changes are found one at a time; while one is
 * found and followed, the file's saver is held, so that no save is sent over
 * a change the user has not seen.
 *
 * - A change whose hash equals the file's last loaded or saved hash is the
 *   file as the editor knows it, which is how the user's own saves are told
 *   apart (A-3.11). A save in flight is waited for first, so that its event,
 *   which can come before its answer, is not taken for a change.
 * - A path this tab is renaming or deleting (`EntryCommandsService
 *   .isOwnChange`) follows FB-36 and FB-39 instead.
 * - Without unsaved edits the file is reloaded and a toast says "This file was
 *   updated."; with them, or when the user typed meanwhile, the editor asks.
 */
@Injectable()
export class DiskChangesService {
  private readonly api = inject(FilesApi);
  private readonly session = inject(RepositorySessionService);
  private readonly openFiles = inject(OpenFilesService);
  private readonly commands = inject(EntryCommandsService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  private readonly changesSubject = new Subject<{ path: string; change: DiskChange; }>();
  /** Each change found, before it is followed. */
  readonly changes: Observable<{ path: string; change: DiskChange; }> = this.changesSubject.asObservable();

  /** The changes being found and followed, one after the other. */
  private queue: Promise<void> = Promise.resolve();

  constructor() {
    const subscription = this.openFiles.missing.subscribe(path =>
      this.follow(path, async () => (this.commands.isOwnChange(path) ? null : { kind: 'gone' }))
    );
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  /**
   * Finds out whether the open file at `path` changed on disk and follows the
   * change, with `known`, the hash an event names, when there is one.
   */
  notice(path: string, known?: string): void {
    this.follow(path, () => this.check(path, known));
  }

  /**
   * How the file at `path` differs on disk from its last load or save, or
   * `null` when it does not, when it is not open, or when this tab is
   * changing it itself. Uses `known` when given and no save was in flight,
   * and otherwise asks the backend for the file's state.
   */
  async check(path: string, known?: string): Promise<DiskChange | null> {
    const file = this.openFiles.get(path);
    if (!file || this.commands.isOwnChange(path)) {
      return null;
    }
    const release = file.saver.hold();
    try {
      const waited = await file.saver.settled();
      if (file.path() !== path || this.commands.isOwnChange(path)) {
        return null;
      }
      const unchanged = (hash: string) => !file.gone() && hash === file.hash();
      if (known !== undefined && (unchanged(known) || !waited)) {
        return unchanged(known) ? null : { kind: 'changed', hash: known };
      }
      const state = await this.stateOf(file);
      if (state === null || this.commands.isOwnChange(path)) {
        return null;
      }
      return state === 'gone' ? { kind: 'gone' } : unchanged(state) ? null : { kind: 'changed', hash: state };
    } finally {
      release();
    }
  }

  /** Finds the change with `find`, after the ones before it, and follows it, holding the file's saver meanwhile. */
  private follow(path: string, find: () => Promise<DiskChange | null>): void {
    this.queue = this.queue.then(async () => {
      const file = this.openFiles.get(path);
      if (!file) {
        return;
      }
      const release = file.saver.hold();
      try {
        const change = await find();
        if (change !== null && this.openFiles.get(path) === file) {
          this.changesSubject.next({ path, change });
          await this.apply(file, path, change);
        }
      } catch {
        // Nothing could be found out; the next event or save tries again.
      } finally {
        release();
      }
    });
  }

  private async apply(file: OpenFile, path: string, change: DiskChange): Promise<void> {
    if (change.kind === 'gone') {
      this.openFiles.markGone(path);
      return;
    }
    if (!file.saver.unsaved()) {
      if (await this.openFiles.reload(path, { discard: false })) {
        this.toast.show({
          message: this.transloco.translate(`${KEY}.updated`),
          dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
          status: 'info',
          key: `${KEY}.updated`
        });
        return;
      }
      if (file.gone()) {
        return;
      }
    }
    this.openFiles.changedOnDisk(path, change.hash);
  }

  /** The file's content hash on disk, `'gone'` when it does not exist, or `null` when that cannot be found out. */
  private async stateOf(file: OpenFile): Promise<string | 'gone' | null> {
    const repositoryId = this.session.repository()?.id;
    if (repositoryId === undefined) {
      return null;
    }
    try {
      return (await firstValueFrom(this.api.fileState(repositoryId, { path: file.path() }))).hash;
    } catch (error) {
      return toApiError(error).code === 'entry-not-found' ? 'gone' : null;
    }
  }
}
