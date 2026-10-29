import { inject, Injectable } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { EntryPath, NewEntryKind } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { FilesApi } from '@front-burner/web-api-client';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import { type NewEntryData, NewEntryDialog } from '../../dialogs/new-entry/new-entry.dialog';
import { type RenameEntryData, RenameEntryDialog } from '../../dialogs/rename-entry/rename-entry.dialog';
import type { EntryAction } from '../../utils/entry-actions/entry-actions';
import { parentPath } from '../../utils/file-name/file-name';
import { FileTreeStoreService } from '../file-tree-store/file-tree-store.service';
import { FirstFileService } from '../first-file/first-file.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

const KEY = 'web-feature-repository-screen.EntryCommandsService';

/**
 * Runs the actions of the file tree (FB-24) on the repository open on the
 * repository screen. Provided by the page. After its own change it lists the
 * parent folder again at once, without waiting for `files.changed`.
 *
 * - **New file** opens the new file (FB-30).
 * - **New folder** expands the new folder and makes it the tree's active row
 *   (FB-32).
 * - **Rename** of a folder that holds non-Markdown files asks a second time,
 *   with the dialog still open (FB-35). The tree keeps a renamed folder as it
 *   was, and when the open file is the entry or lies under it, it stays open
 *   at its new path (FB-36).
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

  /** Runs `action` on the entry at `path`; `''` is the root folder. */
  async run(action: EntryAction, path: string): Promise<void> {
    const repositoryId = this.session.repository()?.id;
    if (repositoryId === undefined) {
      return;
    }
    switch (action) {
      case 'new-file':
      case 'new-folder':
        return this.create(repositoryId, action === 'new-file' ? 'file' : 'folder', path);
      case 'rename':
        return this.rename(repositoryId, path);
      case 'delete':
        // Plan 20.
        return;
    }
  }

  private async create(repositoryId: number, kind: NewEntryKind, folder: string): Promise<void> {
    const data: NewEntryData = {
      repositoryId,
      folder,
      kind,
      folderIgnored: folder !== '' && (this.store.entry(folder)?.ignored ?? false),
      siblings: await this.siblings(folder)
    };
    const ref = this.dialogs.open<NewEntryDialog, NewEntryData, EntryPath>(NewEntryDialog, { data });
    const created = await firstValueFrom(ref.closed);
    if (!created) {
      return;
    }
    this.store.load(folder);
    if (folder !== '') {
      this.store.expand(folder);
    }
    if (kind === 'file') {
      this.go(repositoryId, created.path, false);
    } else {
      this.store.expand(created.path);
      this.store.focusRequest.set(created.path);
    }
  }

  private async rename(repositoryId: number, path: string): Promise<void> {
    const entry = this.store.entry(path);
    if (!entry) {
      return;
    }
    const parent = parentPath(path);
    const data: RenameEntryData = {
      repositoryId,
      path,
      entry,
      siblings: await this.siblings(parent),
      confirm: entry.kind === 'folder' ? () => this.confirmFolderRename(repositoryId, path) : undefined
    };
    const ref = this.dialogs.open<RenameEntryDialog, RenameEntryData, EntryPath>(RenameEntryDialog, { data });
    const renamed = await firstValueFrom(ref.closed);
    if (!renamed) {
      return;
    }
    this.store.renamed(path, renamed.path);
    this.firstFile.renamed(repositoryId, path, renamed.path);
    this.store.load(parent);
    const open = this.route.snapshot.paramMap.get('path') ?? '';
    if (open === path || open.startsWith(`${path}/`)) {
      this.go(repositoryId, `${renamed.path}${open.slice(path.length)}`, true);
    }
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

  /** The names in `folder`, for the dialogs' own clash check; none when it cannot be listed. */
  private async siblings(folder: string): Promise<readonly string[]> {
    return (await this.store.entries(folder))?.map(item => item.name) ?? [];
  }

  private go(repositoryId: number, path: string, replaceUrl: boolean): void {
    void this.router.navigate([ '/repositories', repositoryId, 'files', ...path.split('/') ], { replaceUrl });
  }

  private text(key: string, params?: Record<string, unknown>): string {
    return this.transloco.translate(`${KEY}.${key}`, params);
  }
}
