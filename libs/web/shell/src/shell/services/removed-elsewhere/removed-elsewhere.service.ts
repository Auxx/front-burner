import { inject, Injectable } from '@angular/core';
import { DialogService, ToastService } from '@front-burner/ui';
import { RemovedRepositoriesService } from '@front-burner/web-core';
import { TranslocoService } from '@jsverse/transloco';

const KEY = 'web-shell.RemovedElsewhereService';

/** A page that shows one repository, as `RemovedElsewhereService.watch` sees it. */
export interface RepositoryOnScreen {
  /** The repository shown, with the name the page shows, or `null` while there is none. */
  readonly repository: () => { readonly id: number; readonly name: string; } | null;
  /**
   * Drops every save still waiting for the repository `repositoryId`, which
   * is gone; `true` when there were unsaved edits. Pages that save nothing
   * leave it out.
   */
  readonly dropUnsaved?: (repositoryId: number) => boolean;
}

/**
 * What a page that shows a repository does when it is removed in another tab
 * or on another device (RM-20): before the tab goes to the dashboard, its
 * waiting saves are dropped, its dialogs closed, and "Repository <name>
 * removed." is shown, with the name the page shows. A page that had unsaved
 * edits says that they were not saved _(plan 122's call)_. The navigation and
 * the drafts are `RemovedRepositoriesService`'s.
 */
@Injectable({ providedIn: 'root' })
export class RemovedElsewhereService {
  private readonly removals = inject(RemovedRepositoriesService);
  private readonly dialogs = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  /**
   * Follows the removal of `page`'s repository until the caller is destroyed.
   * Call it in an injection context, such as the page's constructor.
   */
  watch(page: RepositoryOnScreen): void {
    this.removals.watch({
      repositoryId: () => page.repository()?.id ?? null,
      removed: () => {
        const repository = page.repository();
        if (repository === null) {
          return;
        }
        const lost = page.dropUnsaved?.(repository.id) ?? false;
        const name = repository.name;
        this.dialogs.closeAll();
        this.toast.show({
          message: this.transloco.translate(`${KEY}.${lost ? 'removedUnsaved' : 'removed'}`, { name }),
          dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
          status: lost ? 'warning' : 'info'
        });
      }
    });
  }
}
