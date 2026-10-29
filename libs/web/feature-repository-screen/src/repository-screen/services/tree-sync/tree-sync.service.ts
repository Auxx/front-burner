import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { PushEvent } from '@front-burner/shared-contracts';
import { PushChannelService } from '@front-burner/web-core';
import { filter, Subscription } from 'rxjs';

import { ancestors, parentPath } from '../../utils/file-name/file-name';
import { DiskChangesService } from '../disk-changes/disk-changes.service';
import { EntryCommandsService } from '../entry-commands/entry-commands.service';
import { FileTreeStoreService } from '../file-tree-store/file-tree-store.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

/**
 * Keeps the repository screen up to date with changes made elsewhere, from
 * the push channel (A-3.11, A-8.5). Provided by the page.
 *
 * - `files.changed` lists the shown folders it names again (FB-41), except
 *   the event of this tab's own save: one that names only the folders of the
 *   saved files, each an open file whose hash matches its last save (A-3.11).
 *   A listing shows no sizes, so nothing is lost.
 * - `repository.status` goes to `RepositorySessionService.statusChanged`.
 * - A (re)connect lists every shown folder again, since events are never
 *   replayed, reads the repository's status again, and tries again to open
 *   it when that failed.
 *
 * When the open file, which was listed, is gone from the listings that come
 * back, and this tab is not the one that deleted or renamed it
 * (`EntryCommandsService.ownChange`), `goneElsewhere` names it (FB-42); a
 * Markdown file open in the editor is left to `DiskChangesService`, which
 * keeps its unsaved edits (ED-21).
 *
 * The open Markdown file is also checked for changes on disk (ED-23): when an
 * event names it, its folder or `all`, and after a (re)connect. A file that
 * **Recreate it** created lists its folders again, since the event of that
 * looks like the tab's own save.
 */
@Injectable()
export class TreeSyncService {
  private readonly push = inject(PushChannelService);
  private readonly store = inject(FileTreeStoreService);
  private readonly commands = inject(EntryCommandsService);
  private readonly session = inject(RepositorySessionService);
  private readonly openFiles = inject(OpenFilesService);
  private readonly route = inject(ActivatedRoute);
  private readonly diskChanges = inject(DiskChangesService);

  private readonly gone = signal<string | null>(null);
  /** The path of the open file once it was deleted or renamed elsewhere (FB-42). */
  readonly goneElsewhere = this.gone.asReadonly();

  private repositoryId: number | undefined;
  private subscription: Subscription | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.subscription?.unsubscribe());
  }

  /**
   * Follows the events of the repository `repositoryId` until the page is
   * destroyed. Nothing happens for the repository already followed, so that
   * a new file in the route keeps the push channel open.
   */
  start(repositoryId: number): void {
    if (repositoryId === this.repositoryId) {
      return;
    }
    this.repositoryId = repositoryId;
    this.subscription?.unsubscribe();
    const subscription = new Subscription();
    // `reconnected` first, so that the first connect, which the events start, is seen.
    subscription.add(this.push.reconnected.subscribe(() => {
      const state = this.session.state();
      if (state === 'failed') {
        this.session.retry();
      } else if (state === 'ready' || state === 'not-openable') {
        this.session.refresh();
      }
      void this.sync('all');
      this.checkOpenFile('all');
    }));
    subscription.add(
      this.push.events
        .pipe(filter(event => 'repositoryId' in event && event.repositoryId === repositoryId))
        .subscribe(event => {
          if (event.type === 'files.changed') {
            if (!this.ownSave(event)) {
              void this.sync(event.folders);
            }
            this.checkOpenFile(event.folders, event.files);
          } else if (event.type === 'repository.status') {
            this.session.statusChanged(event.status, event.error);
          }
        })
    );
    subscription.add(this.openFiles.recreated.subscribe(path => {
      if (this.gone() === path) {
        this.gone.set(null);
      }
      void this.sync(ancestors(path));
    }));
    this.subscription = subscription;
  }

  /** Has `DiskChangesService` check the open Markdown file when `folders` or `files` may concern it. */
  private checkOpenFile(
    folders: readonly string[] | 'all',
    files: readonly { path: string; hash: string; }[] = []
  ): void {
    const path = this.openFiles.current()?.path();
    if (path === undefined || this.session.state() !== 'ready') {
      return;
    }
    const named = files.find(file => file.path === path);
    if (named) {
      this.diskChanges.notice(path, named.hash);
    } else if (folders === 'all' || folders.includes(parentPath(path))) {
      this.diskChanges.notice(path);
    }
  }

  /** Whether `event` tells only of saves this tab made, as ED-24 tells them apart. */
  private ownSave(event: Extract<PushEvent, { type: 'files.changed'; }>): boolean {
    const files = event.files ?? [];
    if (files.length === 0 || event.folders === 'all') {
      return false;
    }
    const parents = new Set(files.map(file => parentPath(file.path)));
    return event.folders.every(folder => parents.has(folder))
      && files.every(file => {
        const open = this.openFiles.get(file.path);
        return open !== undefined && this.openFiles.isOwnSave(open, file.hash);
      });
  }

  /** Forgets the file gone elsewhere, as when another path is shown. */
  clear(): void {
    this.gone.set(null);
  }

  /**
   * Lists `folders` again, then checks whether the open file is still there.
   * Nothing is listed while the repository cannot be opened: it is listed
   * afresh once it can.
   */
  private async sync(folders: readonly string[] | 'all'): Promise<void> {
    if (this.session.state() !== 'ready') {
      return;
    }
    const path = this.route.snapshot.paramMap.get('path') ?? '';
    const listed = path !== '' && this.store.entry(path) !== undefined;
    // This tab lists the folders it renames or deletes itself; listing them here would find them gone.
    await this.store.reload(folders, folder => this.commands.isOwnChange(folder));
    if (
      listed && path === (this.route.snapshot.paramMap.get('path') ?? '') && !this.commands.isOwnChange(path)
      && this.store.gone(path)
    ) {
      if (this.openFiles.get(path)) {
        this.diskChanges.notice(path);
      } else {
        this.gone.set(path);
      }
    }
  }
}
