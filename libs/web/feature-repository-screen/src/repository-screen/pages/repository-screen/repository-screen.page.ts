import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { ApiError, Entry } from '@front-burner/shared-contracts';
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
import { EntryCommandsService } from '../../services/entry-commands/entry-commands.service';
import { FileTreeStoreService } from '../../services/file-tree-store/file-tree-store.service';
import { FirstFileService } from '../../services/first-file/first-file.service';
import { OpenFilesService } from '../../services/open-files/open-files.service';
import { PaneMemoryService } from '../../services/pane-memory/pane-memory.service';
import { RepositorySessionService } from '../../services/repository-session/repository-session.service';
import { TreeSyncService } from '../../services/tree-sync/tree-sync.service';
import type { EntryAction } from '../../utils/entry-actions/entry-actions';
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
 * file to open, if there is one (FB-12), except after a navigation with
 * `state: { closed: true }`, which closed the open file because it was
 * deleted: the editor area then shows the empty state (FB-39). A Markdown
 * file is opened in the editor through `OpenFilesService` (FB-21, ED-3).
 * Selecting an entry in the tree goes
 * to its path and closes the drawer (FB-9). The tree's actions, and **New
 * file** of the empty editor area, run through `EntryCommandsService` (FB-24).
 * `TreeSyncService` keeps the tree up to date with changes made elsewhere,
 * and says when the open file is gone because of one (FB-41, FB-42); the
 * route stays, so a reload then says it does not exist (FB-13).
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
  providers: [
    RepositorySessionService,
    PaneMemoryService,
    FileTreeStoreService,
    FirstFileService,
    EntryCommandsService,
    TreeSyncService,
    OpenFilesService
  ],
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
  private readonly commands = inject(EntryCommandsService);
  private readonly sync = inject(TreeSyncService);
  protected readonly openFiles = inject(OpenFilesService);

  protected readonly user = this.currentUser.user;
  /** The file tree's size and whether it is collapsed, as this device last left them (FB-8). */
  protected readonly panes = inject(PaneMemoryService);
  /** Whether the file tree is open as the drawer of narrow screens (FB-9). */
  protected readonly drawerOpen = signal(false);
  /**
   * The route's path, and whether the navigation to it closed the open file
   * (FB-39), read while that navigation runs.
   */
  private readonly target = toSignal(
    this.route.paramMap.pipe(map(params => ({
      path: params.get('path') ?? '',
      closed: this.router.currentNavigation()?.extras.state?.['closed'] === true
    }))),
    { requireSync: true }
  );
  /** The open file's path in the working copy, or `''` (FB-1). */
  protected readonly path = computed(() => this.target().path);

  /** The entry highlighted in the tree. */
  protected readonly selectedPath = computed(() => this.path() || null);
  /** What the editor area shows: no file (`null`), or a path, `''` while the first file is picked. */
  protected readonly openPath = signal<string | null>('');
  /** The entry at `openPath`: `null` when there is none, `undefined` while it is being found. */
  protected readonly openEntry = signal<Entry | null | undefined>(undefined);
  /** Why the Markdown file at `openPath` could not be opened. */
  protected readonly openError = signal<ApiError | null>(null);
  /** Whether the open file was deleted or renamed elsewhere (FB-42). */
  protected readonly goneElsewhere = computed(() => {
    const gone = this.sync.goneElsewhere();
    return gone !== null && gone === this.openPath();
  });

  /** Whether the open file has unsaved edits (NV-13). */
  private readonly unsaved = computed(() => this.openFiles.current()?.saver.unsaved() ?? false);

  /** Counts the paths shown, so that only the latest one's answer counts. */
  private showing = 0;
  /** Whether the path shown could not be found because a folder could not be listed. */
  private failed = false;

  constructor() {
    effect(() => {
      const state = this.session.state();
      const repository = state === 'ready' ? this.session.repository() : null;
      const { path, closed } = this.target();
      if (repository) {
        untracked(() => void this.show(repository.id, path, closed));
      } else if (state !== 'loading') {
        // Listed afresh once the repository can be opened again; not while it only opens.
        untracked(() => this.tree.reset());
      }
    });
    this.route.paramMap
      .pipe(map(params => Number(params.get('id'))), takeUntilDestroyed())
      .subscribe(id => {
        // Another repository, through the switcher: its waiting saves are sent at once (NV-12).
        void this.openFiles.flushAll();
        this.session.start(id);
        this.sync.start(id);
      });
    // The app header's loader is not on this screen (NV-9).
    this.currentUser.load().catch(() => undefined);
    this.updateTitle();
    this.flushWhenLeft();
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

  /** Runs an action of the tree; a new file it opens closes the drawer, as a selected one does (FB-9). */
  protected async runAction(action: EntryAction, path: string): Promise<void> {
    if ((await this.commands.run(action, path)) !== null) {
      this.drawerOpen.set(false);
    }
  }

  /**
   * **Try again** on a folder (FB-44); the route's path is shown again if
   * finding it failed, now that the folder is listed again.
   */
  protected retry(folder: string): void {
    this.tree.load(folder);
    const repository = this.session.repository();
    if (this.failed && repository) {
      void this.show(repository.id, this.path(), false);
    }
  }

  /**
   * Shows the route's path in the file tree and the editor area. While a
   * folder it needs cannot be listed, the editor area stays empty: the
   * folder shows **Try again**. Without one,
   * goes to the first file, in place of this URL, so that Back leaves the
   * screen (FB-12); when the open file was just `closed`, shows no file.
   */
  private async show(repositoryId: number, path: string, closed: boolean): Promise<void> {
    const showing = ++this.showing;
    this.failed = false;
    this.tree.init(repositoryId);
    this.sync.clear();
    this.openEntry.set(undefined);
    this.openError.set(null);
    const previous = this.openFiles.current();
    if (previous !== null && previous.path() !== path) {
      // Another file: the previous one's waiting save is sent at once (ED-3, ED-17).
      void previous.saver.flush();
    }
    this.openFiles.clearCurrent();
    if (path === '' && closed) {
      this.openPath.set(null);
      return;
    }
    if (path === '') {
      this.openPath.set('');
      const first = await this.firstFile.pick(repositoryId);
      if (showing !== this.showing) {
        return;
      }
      if (first === 'failed') {
        this.failed = true;
      } else if (first === null) {
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
    if (found === 'failed') {
      this.failed = true;
      return;
    }
    this.openEntry.set(found);
    if (found?.kind === 'file' && found.markdown) {
      this.firstFile.remember(repositoryId, path);
      await this.openFile(path, showing);
    }
  }

  /** **Try again** after the Markdown file at the route's path could not be opened. */
  protected retryOpen(): void {
    const path = this.openPath();
    if (path) {
      this.openError.set(null);
      void this.openFile(path, this.showing);
    }
  }

  /** Opens the Markdown file at `path` in the editor (FB-21, ED-5); only the latest path shown counts. */
  private async openFile(path: string, showing: number): Promise<void> {
    try {
      await this.openFiles.open(path);
    } catch (error) {
      if (showing === this.showing) {
        this.openError.set(error as ApiError);
      }
    }
  }

  /** Sends the waiting saves at once when the tab is hidden or the screen is left (ED-17). */
  private flushWhenLeft(): void {
    const document = inject(DOCUMENT);
    const hidden = () => {
      if (document.visibilityState === 'hidden') {
        void this.openFiles.flushAll();
      }
    };
    document.addEventListener('visibilitychange', hidden);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', hidden);
      void this.openFiles.flushAll();
    });
  }

  /**
   * `<file name> · <repository name> · Front Burner`, or without a file
   * `<repository name> · Front Burner` (NV-13), published again for each file
   * so that it is announced (NV-18), with `• ` in front while the open file
   * has unsaved edits. Until the repository has opened, the
   * product name alone, so that no other page's title stays.
   */
  private updateTitle(): void {
    const pageTitle = inject(PageTitleService);
    const transloco = inject(TranslocoService);
    effect(onCleanup => {
      const state = this.session.state();
      const repository = this.session.repository();
      const file = fileName(this.path());
      const unsaved = this.unsaved();
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
          const title = file ? `${file} · ${repository.name}` : repository.name;
          pageTitle.publish(unsaved ? `• ${title}` : title);
        } else {
          pageTitle.publish();
        }
      });
    });
  }
}
