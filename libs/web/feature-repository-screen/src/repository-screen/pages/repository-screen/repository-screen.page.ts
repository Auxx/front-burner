import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { Entry } from '@front-burner/shared-contracts';
import {
  AppShellComponent,
  AppShellSideDirective,
  ButtonComponent,
  InlineBannerComponent,
  SpinnerComponent
} from '@front-burner/ui';
import { CurrentUserService, PageTitleService } from '@front-burner/web-core';
import { AppHeaderComponent, PageNotFoundPage, RouteAnnouncerComponent } from '@front-burner/web-shell';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { map, take } from 'rxjs';

import { EditorAreaComponent } from '../../components/editor-area/editor-area.component';
import { FileTreeComponent } from '../../components/file-tree/file-tree.component';
import { NotOpenableComponent } from '../../components/not-openable/not-openable.component';
import { RepositoryBarComponent } from '../../components/repository-bar/repository-bar.component';
import { FileTreeStoreService } from '../../services/file-tree-store/file-tree-store.service';
import { FirstFileService } from '../../services/first-file/first-file.service';
import { PaneMemoryService } from '../../services/pane-memory/pane-memory.service';
import { RepositorySessionService } from '../../services/repository-session/repository-session.service';
import { fileName } from '../../utils/file-name/file-name';

/**
 * The repository screen (REQ-FILE-001) at `/repositories/<id>` and
 * `/repositories/<id>/files/<path>`: the combined bar (NV-9), the file tree
 * pane and the editor area. The page stays when only the file in the
 * route changes, so the repository is opened once per visit (FB-11). Nothing
 * of the screen shows until the repository has opened; one that is not the
 * user's, or does not exist, shows Page not found (FB-2).
 *
 * The route's path is the open entry: it is found in the file tree, with the
 * folders that lead to it expanded (FB-14), and a Markdown file is remembered
 * as this device's last file. Without a path, the screen goes to the first
 * file to open, if there is one (FB-12). Selecting an entry in the tree goes
 * to its path and closes the drawer (FB-9).
 */
@Component({
  selector: 'rs-repository-screen',
  imports: [
    TranslocoDirective,
    AppShellComponent,
    AppShellSideDirective,
    ButtonComponent,
    InlineBannerComponent,
    SpinnerComponent,
    AppHeaderComponent,
    PageNotFoundPage,
    RouteAnnouncerComponent,
    EditorAreaComponent,
    FileTreeComponent,
    NotOpenableComponent,
    RepositoryBarComponent
  ],
  providers: [ RepositorySessionService, PaneMemoryService, FileTreeStoreService, FirstFileService ],
  templateUrl: './repository-screen.page.html',
  styleUrl: './repository-screen.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositoryScreenPage {
  protected readonly session = inject(RepositorySessionService);
  private readonly route = inject(ActivatedRoute);
  private readonly currentUser = inject(CurrentUserService);
  private readonly router = inject(Router);
  private readonly firstFile = inject(FirstFileService);
  protected readonly tree = inject(FileTreeStoreService);

  protected readonly user = this.currentUser.user;
  /** The file tree's size and whether it is collapsed, as this device last left them (FB-8). */
  protected readonly panes = inject(PaneMemoryService);
  /** Whether the file tree is open as the drawer of narrow screens (FB-9). */
  protected readonly drawerOpen = signal(false);
  /** The open file's path in the working copy, or `''` (FB-1). */
  protected readonly path = toSignal(this.route.paramMap.pipe(map(params => params.get('path') ?? '')), {
    requireSync: true
  });

  /** The entry highlighted in the tree. */
  protected readonly selectedPath = computed(() => this.path() || null);
  /** What the editor area shows: no file (`null`), or a path, `''` while the first file is picked. */
  protected readonly openPath = signal<string | null>('');
  /** The entry at `openPath`: `null` when there is none, `undefined` while it is being found. */
  protected readonly openEntry = signal<Entry | null | undefined>(undefined);

  /** Counts the paths shown, so that only the latest one's answer counts. */
  private showing = 0;

  constructor() {
    effect(() => {
      const repository = this.session.state() === 'ready' ? this.session.repository() : null;
      const path = this.path();
      if (repository) {
        untracked(() => void this.show(repository.id, path));
      }
    });
    this.route.paramMap
      .pipe(map(params => Number(params.get('id'))), takeUntilDestroyed())
      .subscribe(id => this.session.start(id));
    // The app header's loader is not on this screen (NV-9).
    this.currentUser.load().catch(() => undefined);
    this.updateTitle();
  }

  /** **Files** collapses the tree on wide screens and opens it as a drawer on narrow ones. */
  protected toggleFiles(narrow: boolean): void {
    if (narrow) {
      this.drawerOpen.update(open => !open);
    } else {
      this.panes.sideOpen.update(open => !open);
    }
  }

  /** Goes to the selected entry's path (FB-1) and closes the drawer of narrow screens (FB-9). */
  protected openEntryAt(path: string): void {
    const repository = this.session.repository();
    if (!repository) {
      return;
    }
    this.drawerOpen.set(false);
    void this.router.navigate([ '/repositories', repository.id, 'files', ...path.split('/') ]);
  }

  /**
   * Shows the route's path in the file tree and the editor area. Without one,
   * goes to the first file, in place of this URL, so that Back leaves the
   * screen (FB-12).
   */
  private async show(repositoryId: number, path: string): Promise<void> {
    const showing = ++this.showing;
    this.tree.init(repositoryId);
    this.openEntry.set(undefined);
    if (path === '') {
      this.openPath.set('');
      const first = await this.firstFile.pick(repositoryId);
      if (showing !== this.showing) {
        return;
      }
      if (first === null) {
        this.openPath.set(null);
      } else {
        void this.router.navigate([ '/repositories', repositoryId, 'files', ...first.split('/') ], {
          replaceUrl: true
        });
      }
      return;
    }
    this.openPath.set(path);
    const found = await this.tree.resolve(path);
    if (showing !== this.showing) {
      return;
    }
    this.openEntry.set(found);
    if (found?.kind === 'file' && found.markdown) {
      this.firstFile.remember(repositoryId, path);
    }
  }

  /**
   * `<file name> · <repository name> · Front Burner`, or without a file
   * `<repository name> · Front Burner` (NV-13), published again for each file
   * so that it is announced (NV-18). Until the repository has opened, the
   * product name alone, so that no other page's title stays.
   */
  private updateTitle(): void {
    const pageTitle = inject(PageTitleService);
    const transloco = inject(TranslocoService);
    effect(onCleanup => {
      const state = this.session.state();
      const repository = this.session.repository();
      const file = fileName(this.path());
      untracked(() => {
        if (state === 'loading') {
          pageTitle.setPending();
        } else if (state === 'missing') {
          const pending = transloco.selectTranslate('web-shell.PageNotFoundPage.title').pipe(take(1)).subscribe(
            text => {
              pageTitle.publish(text);
            }
          );
          onCleanup(() => pending.unsubscribe());
        } else if (repository) {
          pageTitle.publish(file ? `${file} · ${repository.name}` : repository.name);
        } else {
          pageTitle.publish();
        }
      });
    });
  }
}
