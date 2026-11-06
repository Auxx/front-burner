import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { ApiError, Entry, GitChange } from '@front-burner/shared-contracts';
import {
  ActivityBarComponent,
  ActivityBarItemComponent,
  AppShellComponent,
  AppShellSideDirective,
  ButtonComponent,
  CentredIslandComponent,
  IconComponent,
  InlineBannerComponent,
  IslandComponent,
  SpinnerComponent
} from '@front-burner/ui';
import { CurrentUserService, PageTitleService } from '@front-burner/web-core';
import type { PreviewPathLink } from '@front-burner/web-markdown';
import { ImageCache } from '@front-burner/web-markdown/images';
import { AppHeaderComponent, PageNotFoundPage, RouteAnnouncerComponent } from '@front-burner/web-shell';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { map, take } from 'rxjs';

import { ChangesPaneComponent } from '../../components/changes-pane/changes-pane.component';
import { DiffViewComponent } from '../../components/diff-view/diff-view.component';
import { EditorAreaComponent } from '../../components/editor-area/editor-area.component';
import { FileTreeComponent } from '../../components/file-tree/file-tree.component';
import { NotOpenableComponent } from '../../components/not-openable/not-openable.component';
import { PushProblemComponent } from '../../components/push-problem/push-problem.component';
import { RepositoryBarComponent } from '../../components/repository-bar/repository-bar.component';
import { CommitAuthorGate } from '../../services/commit-author-gate/commit-author-gate.service';
import { CommitTicksService } from '../../services/commit-ticks/commit-ticks.service';
import { CommitService } from '../../services/commit/commit.service';
import { DiscardService } from '../../services/discard/discard.service';
import { DiskChangesService } from '../../services/disk-changes/disk-changes.service';
import { EntryCommandsService } from '../../services/entry-commands/entry-commands.service';
import { FileTreeStoreService } from '../../services/file-tree-store/file-tree-store.service';
import { FirstFileService } from '../../services/first-file/first-file.service';
import { GitStatusStore } from '../../services/git-status-store/git-status-store.service';
import { OpenFilesService } from '../../services/open-files/open-files.service';
import { PaneMemoryService, type SideTool } from '../../services/pane-memory/pane-memory.service';
import { type PushProblem, PushService } from '../../services/push/push.service';
import { RepositorySessionService } from '../../services/repository-session/repository-session.service';
import { TreeSyncService } from '../../services/tree-sync/tree-sync.service';
import { ViewModeService } from '../../services/view-mode/view-mode.service';
import type { EntryAction } from '../../utils/entry-actions/entry-actions';
import { ancestors, fileName } from '../../utils/file-name/file-name';

/** A larger count shows as `99+`; the item's accessible name says it in full. */
const MAX_BADGE_COUNT = 99;

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
 * route stays, so a reload then says it does not exist (FB-13). Unsaved
 * edits are kept as browser drafts and offered when the file is opened
 * again (ED-7, ED-20). `DiskChangesService` follows changes to the open file
 * on disk (ED-21, ED-24); a file opened again from its kept entry is checked
 * for them, since events about it were not followed while another was open.
 * The activity bar switches the side pane between the file tree and **Changes**
 * (GA-10), whose count and list come from `GitStatusStore`. Both stay in place
 * while the other is shown, so that each keeps its scroll position and active
 * row, and the tree still meets a focus request. Selecting a change shows its
 * diff in place of the editor until a file is opened again (GA-14). It is not in
 * the URL, which keeps naming the open file, so that a reload opens the file; the
 * editor stays in place, hidden, so that it keeps its scroll position and undo.
 * **Discard** runs through `DiscardService` (GA-23); it ends the diff of a file it
 * discards. **Push** in the bar runs through `PushService` (GA-29), and why a push
 * failed is shown below the bar (NV-16).
 */
@Component({
  selector: 'rs-repository-screen',
  imports: [
    TranslocoDirective,
    AppShellComponent,
    AppShellSideDirective,
    ActivityBarComponent,
    ActivityBarItemComponent,
    ButtonComponent,
    CentredIslandComponent,
    IconComponent,
    IslandComponent,
    InlineBannerComponent,
    SpinnerComponent,
    AppHeaderComponent,
    PageNotFoundPage,
    RouteAnnouncerComponent,
    ChangesPaneComponent,
    DiffViewComponent,
    EditorAreaComponent,
    FileTreeComponent,
    NotOpenableComponent,
    PushProblemComponent,
    RepositoryBarComponent
  ],
  providers: [
    RepositorySessionService,
    PaneMemoryService,
    ViewModeService,
    FileTreeStoreService,
    FirstFileService,
    EntryCommandsService,
    TreeSyncService,
    OpenFilesService,
    DiskChangesService,
    GitStatusStore,
    CommitTicksService,
    CommitAuthorGate,
    CommitService,
    DiscardService,
    PushService,
    // One per screen, so that switching files or tabs loads no image again (IM-10).
    ImageCache
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
  private readonly document = inject(DOCUMENT);
  private readonly firstFile = inject(FirstFileService);
  protected readonly tree = inject(FileTreeStoreService);
  private readonly commands = inject(EntryCommandsService);
  private readonly sync = inject(TreeSyncService);
  protected readonly openFiles = inject(OpenFilesService);
  private readonly diskChanges = inject(DiskChangesService);
  protected readonly gitStatus = inject(GitStatusStore);
  private readonly discards = inject(DiscardService);
  protected readonly pushes = inject(PushService);

  protected readonly user = this.currentUser.user;
  /** The side pane's size, whether it is collapsed and its tool window, as this device last left them (FB-8). */
  protected readonly panes = inject(PaneMemoryService);
  /** Whether the side pane is open as the drawer of narrow screens (FB-9). */
  protected readonly drawerOpen = signal(false);
  /** The page's app shell, once there is one; it knows whether the layout is narrow. */
  private readonly shell = viewChild(AppShellComponent);
  private readonly changesPane = viewChild(ChangesPaneComponent);
  /** The activity bar's selected item: the tool window shown, beside the editor or as the drawer (FB-7, FB-9, GA-10). */
  protected readonly sideTool = computed(() => {
    const narrow = this.shell()?.narrow() ?? false;
    return (narrow ? this.drawerOpen() : this.panes.sideOpen()) ? this.panes.sideTool() : null;
  });
  /**
   * The route's repository and path, whether the navigation to it closed the
   * open file (FB-39), and whether it replaced the URL, read while it runs.
   */
  private readonly target = toSignal(
    this.route.paramMap.pipe(map(params => ({
      repositoryId: Number(params.get('id')),
      path: params.get('path') ?? '',
      closed: this.router.currentNavigation()?.extras.state?.['closed'] === true,
      replaced: this.router.currentNavigation()?.extras.replaceUrl === true
    }))),
    { requireSync: true }
  );
  /** What the count of the **Changes** item shows, if anything; `!` when the last read failed. */
  protected readonly changesBadge = computed(() => {
    const count = this.gitStatus.changeCount();
    if (this.gitStatus.failed()) {
      return '!';
    }
    if (count === 0) {
      return null;
    }
    return count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(count);
  });
  /** The open file's path in the working copy, or `''` (FB-1). */
  protected readonly path = computed(() => this.target().path);

  /** The entry highlighted in the tree. */
  protected readonly selectedPath = computed(() => this.path() || null);
  /** The change whose diff the editor area shows, as it was selected; `null` shows the open file (GA-14). */
  private readonly selectedChange = signal<GitChange | null>(null);
  /** Whether the diff waits for the waiting saves, so that it has them. */
  protected readonly diffWaiting = signal(false);
  /** That change, with its state as of the last status: the file can be deleted while its diff is shown. */
  protected readonly diffChange = computed(() => {
    const selected = this.selectedChange();
    if (selected === null) {
      return null;
    }
    return this.gitStatus.status()?.changes.find(change => change.path === selected.path) ?? selected;
  });
  /** The entry highlighted in **Changes**. */
  protected readonly selectedChangePath = computed(() => this.diffChange()?.path ?? this.selectedPath());
  /** The heading of the open file to show in its preview (ED-31). */
  protected readonly fragment = toSignal(this.route.fragment, { initialValue: null });
  /** What the editor area shows: no file (`null`), or a path, `''` while the first file is picked. */
  protected readonly openPath = signal<string | null>('');
  /** The entry at `openPath`: `null` when there is none, `undefined` while it is being found. */
  protected readonly openEntry = signal<Entry | null | undefined>(undefined);
  /** Why the Markdown file at `openPath` could not be opened. */
  protected readonly openError = signal<ApiError | null>(null);
  /**
   * Whether the open file was deleted or renamed elsewhere and is shown as
   * such (FB-42); one with unsaved edits stays in the editor (ED-21).
   */
  protected readonly goneElsewhere = computed(() => {
    const gone = this.sync.goneElsewhere();
    const file = this.openFiles.current();
    return (gone !== null && gone === this.openPath()) || (file?.gone() === true && !file.saver.unsaved());
  });
  /** The open file's save status (ED-18). */
  protected readonly saveStatus = computed(() => {
    const file = this.openFiles.current();
    return file ? this.openFiles.statusOf(file) : null;
  });

  /** Whether the open file has unsaved edits (NV-13). */
  private readonly unsaved = computed(() => this.openFiles.current()?.saver.unsaved() ?? false);

  /** Counts the diffs selected, so that only the latest one's wait for a save counts. */
  private diffsSelected = 0;
  /** Counts the paths shown, so that only the latest one's answer counts. */
  private showing = 0;
  /** Whether the path shown could not be found because a folder could not be listed. */
  private failed = false;

  constructor() {
    this.endDiffWhenFileOpens();
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
        this.gitStatus.start(id);
      });
    // The app header's loader is not on this screen (NV-9).
    this.currentUser.load().catch(() => undefined);
    this.updateTitle();
    this.flushWhenLeft();
  }

  /**
   * An item of the activity bar: another item switches the side pane to it;
   * the selected item, which arrives as `null`, collapses the pane on wide
   * screens and closes the drawer on narrow ones.
   */
  protected selectSideTool(tool: string | null, narrow: boolean): void {
    if (tool !== null) {
      this.panes.sideTool.set(tool as SideTool);
    }
    if (narrow) {
      this.drawerOpen.set(tool !== null);
    } else {
      this.panes.sideOpen.set(tool !== null);
    }
  }

  /**
   * Goes to the selected entry's path (FB-1) and closes the drawer of narrow
   * screens (FB-9). A link in the preview goes the same way, with the heading
   * to show as the fragment (ED-31).
   */
  protected openEntryAt(path: string, fragment: string | null = null): void {
    const repository = this.session.repository();
    if (!repository) {
      return;
    }
    this.drawerOpen.set(false);
    // The route may already name it, when its diff replaced it (GA-14).
    this.selectedChange.set(null);
    void this.router.navigate([ '/repositories', repository.id, 'files', ...path.split('/') ], {
      fragment: fragment ?? undefined
    });
  }

  /**
   * Shows the diff of the selected change (GA-14) and closes the drawer of
   * narrow screens (FB-9). The diff is read once the waiting saves have been
   * answered, so that it has them; a save that failed is left to its retries and
   * says so in the save status.
   */
  protected async openDiff(path: string): Promise<void> {
    const change = this.gitStatus.status()?.changes.find(item => item.path === path);
    if (!change) {
      return;
    }
    const selected = ++this.diffsSelected;
    this.drawerOpen.set(false);
    this.selectedChange.set(change);
    this.diffWaiting.set(this.openFiles.anyUnsaved());
    await this.openFiles.flushAll();
    if (selected === this.diffsSelected) {
      this.diffWaiting.set(false);
    }
  }

  /**
   * **Discard** or **Discard all** (GA-23): the diff of a discarded file ends, and
   * a file that comes back at the route's path, but was not shown, is shown. A
   * discard the user cancelled after a failure may still have discarded some
   * files, the ones no longer in the status.
   */
  protected async discardChanges(changes: readonly GitChange[]): Promise<void> {
    const finished = await this.discards.discard(changes);
    const status = this.gitStatus.status();
    const left = new Set(status?.changes.map(change => change.path));
    const discarded = finished ? changes : status ? changes.filter(change => !left.has(change.path)) : [];
    if (discarded.length === 0) {
      return;
    }
    if (discarded.some(change => change.path === this.selectedChange()?.path)) {
      this.selectedChange.set(null);
    }
    const path = this.path();
    const repository = this.session.repository();
    const cameBack = discarded.some(change => change.path === path && change.state === 'deleted');
    if (cameBack && repository && this.openFiles.current()?.path() !== path) {
      // Its folders may have gone with it, from the listings of the ones above them.
      await Promise.all(ancestors(path).map(folder => this.tree.load(folder)));
      void this.show(repository.id, path, false);
    }
    this.changesPane()?.focusAfterDiscard();
  }

  /**
   * Why the last push failed, as a list of one, so that each new problem gets
   * a banner of its own, which announces it (RC-25).
   */
  protected readonly pushProblems = computed(() => {
    const problem = this.pushes.problem();
    return this.session.state() === 'ready' && problem !== null ? [ problem ] : [];
  });

  /** The fix of a push problem (RC-4); plans 60, 63, 64 and 66 add the dialogs. */
  protected fixPush(fix: PushProblem['fix']): void {
    if (fix === 'retry') {
      void this.pushes.retry();
    }
  }

  /**
   * Follows a link of the preview to another entry (ED-31): like a tree
   * selection, or in a new tab when the user asked for one.
   */
  protected followLink(link: PreviewPathLink): void {
    const repository = this.session.repository();
    if (!repository) {
      return;
    }
    if (!link.newTab) {
      this.openEntryAt(link.path, link.fragment);
      return;
    }
    const tree = this.router.createUrlTree([ '/repositories', repository.id, 'files', ...link.path.split('/') ], {
      fragment: link.fragment ?? undefined
    });
    this.document.defaultView?.open(this.router.serializeUrl(tree), '_blank', 'noopener');
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
    const kept = this.openFiles.get(path) !== undefined;
    try {
      await this.openFiles.open(path);
      if (kept && showing === this.showing) {
        this.diskChanges.notice(path);
      }
    } catch (error) {
      if (showing === this.showing) {
        this.openError.set(error as ApiError);
      }
    }
  }

  /**
   * Opening a file through the route ends the diff, and so does another
   * repository (GA-14). A navigation that only replaces the URL does not open
   * anything: it goes to the first file, or follows the open file being renamed
   * or deleted.
   */
  private endDiffWhenFileOpens(): void {
    let repositoryId: number | null = null;
    effect(() => {
      const target = this.target();
      if (!target.replaced || target.repositoryId !== repositoryId) {
        untracked(() => this.selectedChange.set(null));
      }
      repositoryId = target.repositoryId;
    });
  }

  /**
   * Sends the waiting saves at once when the tab is hidden or the screen is
   * left (ED-17). When the page is hidden for good, such as on a reload, the
   * waiting content is also written as browser drafts (ED-20); closing or
   * reloading the tab with unsaved edits makes the browser ask first (ED-22).
   */
  private flushWhenLeft(): void {
    const document = inject(DOCUMENT);
    const window = document.defaultView;
    const hidden = () => {
      if (document.visibilityState === 'hidden') {
        void this.openFiles.flushAll();
      }
    };
    const pageHidden = () => this.openFiles.writeDrafts();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Browsers that ask only when it is set.
      event.returnValue = '';
    };
    document.addEventListener('visibilitychange', hidden);
    window?.addEventListener('pagehide', pageHidden);
    // Only while there are unsaved edits: the listener keeps the page out of
    // the back/forward cache in some browsers.
    effect(onCleanup => {
      if (this.openFiles.anyUnsaved()) {
        window?.addEventListener('beforeunload', beforeUnload);
        onCleanup(() => window?.removeEventListener('beforeunload', beforeUnload));
      }
    });
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', hidden);
      window?.removeEventListener('pagehide', pageHidden);
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
    /** What the title last announced was for: the mark alone changes it without announcing it again. */
    let announced: string | undefined;
    effect(onCleanup => {
      const state = this.session.state();
      const repository = this.session.repository();
      const path = this.path();
      const file = fileName(path);
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
          const marked = unsaved ? `• ${title}` : title;
          const shown = `${repository.id}:${repository.name}:${path}`;
          if (shown === announced) {
            pageTitle.update(marked);
          } else {
            announced = shown;
            pageTitle.publish(marked);
          }
        } else {
          pageTitle.publish();
        }
      });
    });
  }
}
