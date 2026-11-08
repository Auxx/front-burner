import { inject, Injectable } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { GitChange } from '@front-burner/shared-contracts';
import { DialogService } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { firstValueFrom } from 'rxjs';

import { type DiscardChangesData, DiscardChangesDialog } from '../../dialogs/discard-changes/discard-changes.dialog';
import { discardBatches } from '../../utils/discard-batches/discard-batches';
import { EntryCommandsService, OWN_CHANGE_MS } from '../entry-commands/entry-commands.service';
import { FirstFileService } from '../first-file/first-file.service';
import { GitStatusStore } from '../git-status-store/git-status-store.service';
import { OpenFilesService } from '../open-files/open-files.service';
import { RepositorySessionService } from '../repository-session/repository-session.service';

/**
 * **Discard** and **Discard all** of **Changes** (GA-23, GA-24). Provided by the
 * page. The order of the steps is what keeps a late save from bringing a change
 * back, so that they are all here:
 *
 * 1. the user confirms;
 * 2. each open file's waiting save and browser draft are dropped, and a save in
 *    flight is waited for, since it would land after the discard otherwise;
 * 3. the paths are sent, in several requests when they are many;
 * 4. an open file is reloaded without ED-24's question, or closed when it was
 *    an added file (FB-39), and the drafts of files not open here are deleted.
 *
 * When a request fails, its files keep what the editor holds, which is saved
 * again (GA-43). The requests that were answered stay done, and **Try again**
 * goes on with the others, whose paths are still those the user confirmed.
 */
@Injectable()
export class DiscardService {
  private readonly dialogs = inject(DialogService);
  private readonly api = inject(GitApi);
  private readonly status = inject(GitStatusStore);
  private readonly openFiles = inject(OpenFilesService);
  private readonly commands = inject(EntryCommandsService);
  private readonly firstFile = inject(FirstFileService);
  private readonly session = inject(RepositorySessionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private running = false;

  /**
   * Asks, then discards `changes`, which are the ones the user was shown.
   * Resolves `true` when the files were discarded, and `false` when the user
   * cancelled, also after a failure.
   */
  async discard(changes: readonly GitChange[]): Promise<boolean> {
    const repositoryId = this.session.repository()?.id;
    if (repositoryId === undefined || this.running || changes.length === 0) {
      return false;
    }
    this.running = true;
    try {
      const added = new Set(changes.filter(change => change.state === 'added').map(change => change.path));
      const batches = discardBatches(changes.map(change => change.path));
      const route = this.routePath();
      // A navigation closes the dialog (browser Back, say), and whatever is left then stays as it is.
      let open = true;
      const ref = this.dialogs.open<DiscardChangesDialog, DiscardChangesData, boolean>(DiscardChangesDialog, {
        data: {
          count: changes.length,
          discard: async () => {
            try {
              while (open && batches.length > 0) {
                await this.send(repositoryId, batches[0], added);
                batches.shift();
              }
            } finally {
              await this.status.refresh();
            }
          }
        }
      });
      const discarded = await firstValueFrom(ref.closed) === true;
      open = false;
      // After the dialog, since a navigation closes it. Also when a later request failed.
      const stayed = this.routePath() === route && this.session.repository()?.id === repositoryId;
      if (stayed && route !== '' && added.has(route) && !batches.flat().includes(route)) {
        // The page shows the empty state for this navigation, not the README (FB-39).
        void this.router.navigate([ '/repositories', repositoryId ], { replaceUrl: true, state: { closed: true } });
      }
      return discarded;
    } finally {
      this.running = false;
    }
  }

  private async send(repositoryId: number, paths: readonly string[], added: ReadonlySet<string>): Promise<void> {
    const route = this.routePath();
    // Only these can be followed as a change on disk, which this one is not (ED-24, FB-42).
    const shown = paths.filter(path => this.openFiles.get(path) !== undefined || path === route);
    const own = new Map(shown.map(path => [ path, this.commands.ownChange(path) ]));
    // Those with no entry have no save to wait for, and keep their drafts if this fails.
    const notOpen = paths.filter(path => this.openFiles.get(path) === undefined);
    const dropped = await Promise.all(shown.map(path => this.openFiles.dropForDiscard(path)));
    try {
      await firstValueFrom(this.api.discard(repositoryId, { paths: [ ...paths ] }), { defaultValue: undefined });
    } catch (error) {
      dropped.forEach(file => file?.restore());
      own.forEach(release => release());
      throw error;
    }
    void this.openFiles.deleteDrafts(repositoryId, notOpen);
    if (this.session.repository()?.id !== repositoryId) {
      // Navigated meanwhile: the entries at these paths are now another repository's.
      dropped.forEach(file => file?.release());
      own.forEach(release => release());
      return;
    }
    await Promise.all(shown.map(async (path, index) => {
      const release = own.get(path) as () => void;
      let reloaded = true;
      if (added.has(path)) {
        this.openFiles.close(path, { dropPending: true, keepDraft: true });
        this.firstFile.deleted(repositoryId, path);
      } else {
        reloaded = await this.openFiles.reloadDropped(path);
      }
      dropped[index]?.release();
      if (reloaded) {
        setTimeout(release, OWN_CHANGE_MS);
      } else {
        // Later events may find the new content.
        release();
      }
    }));
  }

  private routePath(): string {
    return this.route.snapshot.paramMap.get('path') ?? '';
  }
}
