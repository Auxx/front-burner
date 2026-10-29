import { inject, Injectable } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { EntryPath, NewEntryKind } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { FilesApi } from '@front-burner/web-api-client';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { type DeleteEntryData, DeleteEntryDialog } from '../../dialogs/delete-entry/delete-entry.dialog';
import { type EntryNameData, EntryNameDialog } from '../../dialogs/entry-name/entry-name.dialog';
import type { EntryAction } from '../../utils/entry-actions/entry-actions';
import { fileName, isWithin, joinPath, movedPath, parentPath } from '../../utils/file-name/file-name';
import { FileTreeStoreService } from '../file-tree-store/file-tree-store.service';
import { FirstFileService } from '../first-file/first-file.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

const KEY = 'web-feature-repository-screen.EntryCommandsService';

/** How long after its answer a rename or delete still counts as this tab's own, for its late events. */
export const OWN_CHANGE_MS = 5000;

/**
 * Runs the actions of the file tree (FB-24) on the repository open on the
 * repository screen. Provided by the page. One action runs at a time: another
 * asked for meanwhile, such as by a second click while a folder is listed,
 * is ignored. After its own change it lists the parent folder again at once,
 * without waiting for `files.changed`, and makes the new or renamed entry
 * known to the tree, so that it is found also in a folder that lists only its
 * first entries (FB-18).
 *
 * - **New file** opens the new file (FB-30).
 * - **New folder** expands the new folder and makes it the tree's active row
 *   (FB-32).
 * - **Rename** of a folder that holds non-Markdown files asks a second time,
 *   with the dialog still open (FB-35). The tree keeps a renamed folder as it
 *   was, and when the open file is the entry or lies under it, it stays open
 *   at its new path (FB-36).
 * - **Delete** asks first, saying what cannot be recovered (FB-38), and marks
 *   the entry as deleting while it runs (FB-40). When the open file is the
 *   entry or lies under it, the screen closes it and shows the empty state,
 *   not the README (FB-39).
 *
 * The entries a rename or delete changes are this tab's own changes
 * (`ownChange`) from when its dialog opens until {@link OWN_CHANGE_MS} after
 * it closes, so that their `files.changed` events, which can come before the
 * answer, are not taken for changes made elsewhere (FB-42).
 */
@Injectable()
export class EntryCommandsService {
  private readonly dialogs = inject(DialogService);
  private readonly api = inject(FilesApi);
  private readonly store = inject(FileTreeStoreService);
  private readonly firstFile = inject(FirstFileService);
  private readonly session = inject(RepositorySessionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);

  private running = false;
  /** The paths changed by this tab, one mark per change. */
  private readonly own = new Set<{ readonly path: string; }>();

  /**
   * Runs `action` on the entry at `path`; `''` is the root folder. Resolves to
   * the path of the file it opened, if any, so that the page can close the
   * drawer of narrow screens as for a file selected in the tree (FB-9).
   */
  async run(action: EntryAction, path: string): Promise<string | null> {
    const repositoryId = this.session.repository()?.id;
    if (repositoryId === undefined || this.running) {
      return null;
    }
    this.running = true;
    try {
      switch (action) {
        case 'new-file':
        case 'new-folder':
          return await this.create(repositoryId, action === 'new-file' ? 'file' : 'folder', path);
        case 'rename':
          await this.rename(repositoryId, path);
          return null;
        case 'delete':
          await this.delete(repositoryId, path);
          return null;
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Marks `path` and everything under it as changed by this tab, until the
   * returned function is called.
   */
  ownChange(path: string): () => void {
    const mark = { path };
    this.own.add(mark);
    return () => this.own.delete(mark);
  }

  /** Whether `path` is, or lies under, an entry this tab is changing or has just changed. */
  isOwnChange(path: string): boolean {
    return [ ...this.own ].some(mark => isWithin(path, mark.path));
  }

  private async create(repositoryId: number, kind: NewEntryKind, folder: string): Promise<string | null> {
    const listing = await this.store.listing(folder);
    const folderIgnored = listing?.ignored ?? false;
    const created = await this.ask({
      mode: 'create',
      repositoryId,
      folder,
      kind,
      folderIgnored,
      siblings: listing?.entries.map(item => item.name) ?? []
    });
    if (!created) {
      return null;
    }
    this.store.known(created.path, {
      name: fileName(created.path),
      kind,
      size: kind === 'file' ? 0 : null,
      markdown: kind === 'file',
      ignored: folderIgnored,
      empty: kind === 'folder'
    });
    const listed = this.store.load(folder);
    if (folder !== '') {
      this.store.expand(folder);
    }
    if (kind === 'file') {
      this.go(repositoryId, created.path, false);
      return created.path;
    }
    this.store.expand(created.path);
    // Once its row is listed, so that the request is met at once or not at all.
    await listed;
    this.store.focusRequest.set(created.path);
    return null;
  }

  private async rename(repositoryId: number, path: string): Promise<void> {
    const entry = await this.store.lookup(path);
    if (!entry) {
      return;
    }
    const parent = parentPath(path);
    const done = this.ownChange(path);
    const renamed = await this.ask({
      mode: 'rename',
      repositoryId,
      path,
      entry,
      siblings: (await this.store.entries(parent))?.map(item => item.name) ?? [],
      confirm: entry.kind === 'folder' ? () => this.confirmFolderRename(repositoryId, path) : undefined
    });
    setTimeout(done, renamed ? OWN_CHANGE_MS : 0);
    if (!renamed) {
      return;
    }
    this.store.renamed(path, renamed.path);
    this.store.known(renamed.path, { ...entry, name: fileName(renamed.path) });
    this.firstFile.renamed(repositoryId, path, renamed.path);
    void this.store.load(parent);
    const open = movedPath(this.route.snapshot.paramMap.get('path') ?? '', path, renamed.path);
    if (open !== null) {
      this.go(repositoryId, open, true);
    }
  }

  private async delete(repositoryId: number, path: string): Promise<void> {
    const entry = await this.store.lookup(path);
    if (!entry) {
      return;
    }
    const parent = parentPath(path);
    const siblings = (await this.store.entries(parent))?.map(item => joinPath(parent, item.name)) ?? [];
    const done = this.ownChange(path);
    const ref = this.dialogs.open<DeleteEntryDialog, DeleteEntryData, boolean>(DeleteEntryDialog, {
      data: { repositoryId, path, entry, marked: deleting => this.store.markDeleting(path, deleting) }
    });
    const confirmed = await firstValueFrom(ref.closed);
    setTimeout(done, confirmed ? OWN_CHANGE_MS : 0);
    if (!confirmed) {
      return;
    }
    if (isWithin(this.route.snapshot.paramMap.get('path') ?? '', path)) {
      // The page shows the empty state for this navigation, not the README (FB-39).
      void this.router.navigate([ '/repositories', repositoryId ], { replaceUrl: true, state: { closed: true } });
    }
    this.firstFile.deleted(repositoryId, path);
    // The row keeps its mark until the listing without it is shown.
    await this.store.load(parent);
    this.store.deleted(path);
    this.store.focusRequest.set(await this.focusAfterDelete(path, parent, siblings));
  }

  /**
   * Where the focus goes once the entry at `path` is gone, as its row and the
   * button that opened the dialog are: the entry that took its place, else
   * the one before it, else its folder; `null` for an empty root folder.
   */
  private async focusAfterDelete(path: string, parent: string, siblings: readonly string[]): Promise<string | null> {
    const remaining = new Set((await this.store.entries(parent))?.map(item => joinPath(parent, item.name)) ?? []);
    const index = siblings.indexOf(path);
    const next = siblings.slice(index + 1).find(item => remaining.has(item))
      ?? siblings.slice(0, Math.max(index, 0)).reverse().find(item => remaining.has(item));
    return next ?? (parent === '' ? null : parent);
  }

  private ask(data: EntryNameData): Promise<EntryPath | undefined> {
    const ref = this.dialogs.open<EntryNameDialog, EntryNameData, EntryPath>(EntryNameDialog, { data });
    return firstValueFrom(ref.closed);
  }

  /** The second confirmation of FB-35, only for a folder that holds non-Markdown files. */
  private async confirmFolderRename(repositoryId: number, path: string): Promise<boolean> {
    const summary = await firstValueFrom(this.api.entrySummary(repositoryId, { path }));
    if (summary.nonMarkdown === 0) {
      return true;
    }
    return this.dialogs.confirm({
      heading: this.text('renameFolder.heading'),
      message: this.text('renameFolder.message', { count: summary.nonMarkdown }),
      confirmLabel: this.text('renameFolder.confirm'),
      cancelLabel: this.text('renameFolder.cancel')
    });
  }

  private go(repositoryId: number, path: string, replaceUrl: boolean): void {
    void this.router.navigate([ '/repositories', repositoryId, 'files', ...path.split('/') ], { replaceUrl });
  }

  private text(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`${KEY}.${key}`, params);
  }
}
