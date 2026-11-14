import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import type { ApiError, Entry, GitChange, GitProblemState } from '@front-burner/shared-contracts';
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
import { GitApi } from '@front-burner/web-api-client';
import { CurrentUserService, PageTitleService, PushChannelService } from '@front-burner/web-core';
import type { PreviewPathLink } from '@front-burner/web-markdown';
import { ImageCache } from '@front-burner/web-markdown/images';
import { AppHeaderComponent, PageNotFoundPage, RouteAnnouncerComponent } from '@front-burner/web-shell';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { map, merge, take } from 'rxjs';

import { ChangesPaneComponent } from '../../components/changes-pane/changes-pane.component';
import { ConflictFileComponent } from '../../components/conflict-file/conflict-file.component';
import { ConflictListComponent } from '../../components/conflict-list/conflict-list.component';
import { DiffViewComponent } from '../../components/diff-view/diff-view.component';
import { EditorAreaComponent } from '../../components/editor-area/editor-area.component';
import { FileTreeComponent } from '../../components/file-tree/file-tree.component';
import { GitProblemComponent } from '../../components/git-problem/git-problem.component';
import { LockedKeyBannerComponent } from '../../components/locked-key-banner/locked-key-banner.component';
import { MergeCommittedComponent } from '../../components/merge-committed/merge-committed.component';
import { NotOpenableComponent } from '../../components/not-openable/not-openable.component';
import { RemoteChangeNoticeComponent } from '../../components/remote-change-notice/remote-change-notice.component';
import { RepositoryBarComponent } from '../../components/repository-bar/repository-bar.component';
import { BranchActionsService } from '../../services/branch-actions/branch-actions.service';
import { CommitAuthorGate } from '../../services/commit-author-gate/commit-author-gate.service';
import { CommitTicksService } from '../../services/commit-ticks/commit-ticks.service';
import { CommitService } from '../../services/commit/commit.service';
import { CredentialFixesService } from '../../services/credential-fixes/credential-fixes.service';
import { DiscardService } from '../../services/discard/discard.service';
import { DiskChangesService } from '../../services/disk-changes/disk-changes.service';
import { EntryCommandsService } from '../../services/entry-commands/entry-commands.service';
import { FileTreeStoreService } from '../../services/file-tree-store/file-tree-store.service';
import { FirstFileService } from '../../services/first-file/first-file.service';
import { GitStatusStore } from '../../services/git-status-store/git-status-store.service';
import { LockedKeyService } from '../../services/locked-key/locked-key.service';
import { MergeActionsService } from '../../services/merge-actions/merge-actions.service';
import { MergeStore } from '../../services/merge-store/merge-store.service';
import { type GitProblem, NetworkJobService } from '../../services/network-job/network-job.service';
import { type OpenFile, OpenFilesService } from '../../services/open-files/open-files.service';
import { PaneMemoryService, type SideTool } from '../../services/pane-memory/pane-memory.service';
import { RemoteChangesService } from '../../services/remote-changes/remote-changes.service';
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
 * as this device's last file. Opening a file asks the backend for a fetch
 * (GA-33). Without a path, the screen goes to the first
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
 * discards. **Push** in the bar runs through `NetworkJobService` (GA-29), and why a push
 * failed is shown below the bar (NV-16), as is the locked-key banner of
 * `LockedKeyService` (RC-15). The bar also shows, quietly, why background fetches
 * aren't working (GA-35, RC-6), which stays when the banner is dismissed. During a
 * merge, followed by `MergeStore`, the bar says what merges and offers **Abort merge**
 * through `MergeActionsService` (GC-2, GC-6, GC-23). Below the bar too, `RemoteChangesService`'s
 * notice says when a fetch found new commits, with **Pull** (GA-34); the focus goes to the
 * git actions when it goes away with the focus in it. The branch in the bar opens the
 * branch list, and `BranchActionsService` switches to the branch chosen there, or says
 * why not, with **Show changes** (GA-36, GA-37, GA-39). What follows a switch needs
 * nothing of its own: to `TreeSyncService` it is a change made elsewhere (GA-40).
 * During a merge, the side pane lists the conflicting files instead of the tree and
 * **Changes**, and the editor area shows the one selected in `MergeStore` (GC-7, GC-8,
 * FB-26), whose whole versions `MergeActionsService` resolves it with (GC-15, GC-16). The tree, **Changes** and the editor stay in place, hidden, so that they keep
 * their state, unsaved edits included, for when the merge ends (ED-25). A conflicting file that can be edited
 * opens there in the editor, with its conflicts, as the open file but not the route's (GC-9, GC-12).
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
    ConflictFileComponent,
    ConflictListComponent,
    DiffViewComponent,
    EditorAreaComponent,
    FileTreeComponent,
    LockedKeyBannerComponent,
    NotOpenableComponent,
    GitProblemComponent,
    RemoteChangeNoticeComponent,
    MergeCommittedComponent,
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
    MergeStore,
    MergeActionsService,
    CommitTicksService,
    CommitAuthorGate,
    CommitService,
    DiscardService,
    LockedKeyService,
    NetworkJobService,
    RemoteChangesService,
    CredentialFixesService,
    BranchActionsService,
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly firstFile = inject(FirstFileService);
  protected readonly tree = inject(FileTreeStoreService);
  private readonly commands = inject(EntryCommandsService);
  private readonly sync = inject(TreeSyncService);
  protected readonly openFiles = inject(OpenFilesService);
  private readonly diskChanges = inject(DiskChangesService);
  protected readonly gitStatus = inject(GitStatusStore);
  protected readonly merge = inject(MergeStore);
  protected readonly mergeActions = inject(MergeActionsService);
  private readonly discards = inject(DiscardService);
  protected readonly jobs = inject(NetworkJobService);
  protected readonly lockedKey = inject(LockedKeyService);
  protected readonly remoteChanges = inject(RemoteChangesService);
  private readonly credentialFixes = inject(CredentialFixesService);
  private readonly pushChannel = inject(PushChannelService);
  private readonly git = inject(GitApi);
  protected readonly branchActions = inject(BranchActionsService);

  protected readonly user = this.currentUser.user;
  /** The side pane's size, whether it is collapsed and its tool window, as this device last left them (FB-8). */
  protected readonly panes = inject(PaneMemoryService);
  /** Whether the side pane is open as the drawer of narrow screens (FB-9). */
  protected readonly drawerOpen = signal(false);
  /** The page's app shell, once there is one; it knows whether the layout is narrow. */
  private readonly shell = viewChild(AppShellComponent);
  private readonly changesPane = viewChild(ChangesPaneComponent);
  private readonly bar = viewChild(RepositoryBarComponent);
  private readonly conflictList = viewChild(ConflictListComponent);
  /**
   * The activity bar's selected item: the tool window shown, beside the editor or as the drawer (FB-7, FB-9, GA-10).
   * During a merge, the conflicting files are the only one (GC-7); the tool remembered stays for after it.
   */
  protected readonly sideTool = computed(() => {
    const narrow = this.shell()?.narrow() ?? false;
    if (!(narrow ? this.drawerOpen() : this.panes.sideOpen())) {
      return null;
    }
    return this.merge.merging() ? 'conflicts' : this.panes.sideTool();
  });
  /** The resolution running for the conflicting file shown, if any (GC-15, GC-16). */
  protected readonly conflictResolving = computed(() => {
    const running = this.mergeActions.resolving();
    return running !== null && running.path === this.merge.selected() ? running.resolution : null;
  });
  /** Whether no conflicting file can be resolved now: one is being resolved, or the merge aborted. */
  protected readonly conflictsLocked = computed(() =>
    this.mergeActions.resolving() !== null || this.mergeActions.aborting()
  );
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

  /**
   * The conflicting file edited with its conflicts (GC-9): its path, and the file
   * once it has opened, or why it could not; `null` while the file shown can't be
   * edited, and without a merge.
   */
  protected readonly conflictEditing = signal<{ path: string; file: OpenFile | null; error: ApiError | null; } | null>(
    null
  );
  /**
   * The file the editor area shows: the open file, but during a merge the route's,
   * hidden, while the conflicting file edited is the open one; none when they are
   * the same file, which only one editor may show.
   */
  protected readonly areaFile = computed(() => {
    const current = this.openFiles.current();
    const editing = this.conflictEditing()?.file ?? null;
    if (current === null || current !== editing) {
      return current;
    }
    const path = this.openPath();
    const routeFile = path ? (this.openFiles.get(path) ?? null) : null;
    return routeFile === editing ? null : routeFile;
  });
  /** The savers held during a merge, each released on its own (ED-25, GC-12). */
  private mergeHolds: Map<OpenFile, () => void> | null = null;
  /** Counts the conflicting files opened, so that only the latest one counts. */
  private conflictOpening = 0;
  /** Whether a conflicting file was opened during this merge, so that the route's file is opened again after it. */
  private conflictOpened = false;

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
        // Before the services start: they subscribe to the push channel, which then opens with this repository.
        this.pushChannel.view(id);
        this.session.start(id);
        this.sync.start(id);
        this.gitStatus.start(id);
      });
    // The app header's loader is not on this screen (NV-9).
    this.currentUser.load().catch(() => undefined);
    merge(this.credentialFixes.showChanges, this.branchActions.showChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.selectSideTool('changes', this.shell()?.narrow() ?? false));
    this.updateTitle();
    this.flushWhenLeft();
    this.viewRepository();
    this.keepFocusWhenNoticeGoes();
    this.closeBranchListWhenMergeStarts();
    this.followMergeInSidePane();
    this.holdSavesDuringMerge();
    this.editConflictingFiles();
  }

  /**
   * During a merge, the files open before it are hidden, and a save of one of them
   * would be refused, or for a conflicting file would write over its conflict
   * markers. Their savers are held, and what waits is kept as browser drafts
   * (ED-25); the waiting saves are sent once the merge ends. Leaving the screen
   * meanwhile sends nothing: the drafts keep the edits. A conflicting file edited
   * during the merge saves again once it is open (`openConflict`).
   */
  private holdSavesDuringMerge(): void {
    effect(() => {
      const merging = this.merge.merging();
      untracked(() => {
        if (merging && this.mergeHolds === null) {
          this.mergeHolds = this.openFiles.holdEach();
          this.openFiles.writeDrafts();
        } else if (!merging && this.mergeHolds !== null) {
          this.mergeHolds.forEach(release => release());
          this.mergeHolds = null;
        }
      });
    });
  }

  /**
   * The conflicting file selected during a merge, when it is unresolved and can be
   * edited, opens in the editor with its conflicts (GC-9). It is opened through
   * `OpenFilesService` without going through the route, which keeps naming the
   * file that was open, so it saves, keeps browser drafts and follows changes made
   * elsewhere as any open file (GC-12, ED-24), and is never remembered as this
   * device's last file (FB-12). When the merge ends, the route's file is opened
   * again, or the empty state shown without one.
   */
  private editConflictingFiles(): void {
    effect(() => {
      const file = this.merge.selectedFile();
      const path = file?.editable && !file.resolved ? file.path : null;
      untracked(() => {
        if (path !== (this.conflictEditing()?.path ?? null)) {
          void this.openConflict(path);
        }
      });
    });
    effect(() => {
      const merging = this.merge.merging();
      const repository = this.session.repository();
      untracked(() => {
        if (merging || !this.conflictOpened) {
          return;
        }
        this.conflictOpened = false;
        if (repository) {
          const path = this.path();
          void this.show(repository.id, path, path === '');
        }
      });
    });
  }

  /**
   * Opens the conflicting file at `path` for editing, or none. One already open, as
   * the route's file before the merge, is checked for the merge's change on disk
   * first, which loads the markers or asks **Reload** or **Keep mine** (ED-24), and
   * only then may save again: a save waiting from before the merge would otherwise
   * write over its markers.
   */
  private async openConflict(path: string | null): Promise<void> {
    const opening = ++this.conflictOpening;
    if (path === null) {
      this.conflictEditing.set(null);
      return;
    }
    this.conflictEditing.set({ path, file: null, error: null });
    // Before the file has opened: a merge that ends meanwhile opens the route's file again, which makes this
    // opening too late to become the open file.
    this.conflictOpened = true;
    const kept = this.openFiles.get(path) !== undefined;
    try {
      const file = await this.openFiles.open(path);
      if (kept) {
        this.diskChanges.notice(path);
        await this.diskChanges.settled();
      }
      const release = this.mergeHolds?.get(file);
      if (release) {
        this.mergeHolds?.delete(file);
        release();
      }
      if (opening === this.conflictOpening) {
        this.conflictEditing.set({ path, file, error: null });
      }
    } catch (error) {
      if (opening === this.conflictOpening) {
        this.conflictEditing.set({ path, file: null, error: error as ApiError });
      }
    }
  }

  /** **Try again** after the conflicting file could not be opened for editing. */
  protected retryConflict(): void {
    const path = this.conflictEditing()?.path;
    if (path) {
      void this.openConflict(path);
    }
  }

  /**
   * A merge starting, also elsewhere, ends the diff, so that the screen shows the
   * file again once it ends (GA-14, GC-7). It replaces the tree and **Changes** with
   * the conflicting files, and their activity bar items with one of its own: the
   * focus in any of them goes to the conflicting files once they are listed, or to
   * the item while the pane is collapsed. When the merge ends, the focus in the
   * list goes to the activity bar's selected item, as the list goes too.
   */
  private followMergeInSidePane(): void {
    const injector = inject(Injector);
    let wasMerging = false;
    /** Whether the focus waits for the conflict list, which shows once the merge has been read. */
    const listWaits = signal(false);
    effect(() => {
      const merging = this.merge.merging();
      if (merging === wasMerging) {
        return;
      }
      wasMerging = merging;
      untracked(() => {
        if (merging) {
          this.selectedChange.set(null);
        }
        listWaits.set(false);
        if (!this.focusInSide()) {
          return;
        }
        if (merging && this.sideTool() !== null) {
          listWaits.set(true);
        } else {
          afterNextRender(() => this.focusActivityItem(), { injector });
        }
      });
    });
    effect(() => {
      const list = this.conflictList();
      if (list && listWaits()) {
        untracked(() => listWaits.set(false));
        afterNextRender(() => {
          // Unless the user has put the focus somewhere else meanwhile.
          if (this.focusInSide() || this.document.activeElement === this.document.body) {
            list.focus();
          }
        }, { injector });
      }
    });
  }

  /** Whether the focus is in the activity bar or the side pane. */
  private focusInSide(): boolean {
    const focused = this.document.activeElement;
    return (focused?.closest('ui-activity-bar, rs-file-tree, rs-changes-pane, rs-conflict-list') ?? null) !== null;
  }

  /** Focuses the activity bar's selected item, or its first one. */
  private focusActivityItem(): void {
    const bar = this.host.querySelector('ui-activity-bar');
    const item = bar?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? bar?.querySelector<HTMLElement>('button');
    item?.focus();
  }

  /**
   * A merge starting, also elsewhere, closes the branch list, since switching isn't
   * offered during one (AC-GIT-002.20). It takes away the button that the focus
   * would return to, so the focus goes to what replaces it.
   */
  private closeBranchListWhenMergeStarts(): void {
    const injector = inject(Injector);
    effect(() => {
      if (this.merge.merging() && this.branchActions.closeList()) {
        afterNextRender(() => this.bar()?.focusActions(), { injector });
      }
    });
  }

  /**
   * **Pull**, **Push** or dismissing removes a notice, with the button that has
   * the focus. This runs before the page shows it, so what is focused is still there.
   */
  private keepFocusWhenNoticeGoes(): void {
    this.keepFocusWhenGone(() => this.remoteChanges.notice() !== null, 'rs-remote-change-notice');
    this.keepFocusWhenGone(this.mergeCommitted, 'rs-merge-committed');
  }

  private keepFocusWhenGone(shownNow: () => boolean, selector: string): void {
    const injector = inject(Injector);
    let shown = false;
    effect(() => {
      const nowShown = shownNow();
      if (shown && !nowShown && this.document.activeElement?.closest(selector)) {
        afterNextRender(() => this.bar()?.focusActions(), { injector });
      }
      shown = nowShown;
    });
  }

  /**
   * **Commit merge**. The dialog gives the focus back to the button that opened
   * it, which goes when the merge ends: the bar's actions then take it.
   */
  protected async commitMerge(): Promise<void> {
    await this.mergeActions.commit();
    afterNextRender(() => {
      const active = this.document.activeElement;
      if (active === null || active === this.document.body || !active.isConnected) {
        this.bar()?.focusActions();
      }
    }, { injector: this.injector });
  }

  /**
   * **Push** in the merge-committed notice runs as in the bar, and the notice
   * goes. A network job running meanwhile, such as a background fetch, is waited
   * for, as the notice is gone and the push must not be lost to it.
   */
  protected pushMerge(): void {
    this.dismissMergeCommitted();
    void this.jobs.startWhenFree('push');
  }

  /** The merge-committed notice is dismissed for the visit, for this merge commit. */
  protected dismissMergeCommitted(): void {
    this.dismissedMerge.set(this.gitStatus.status()?.lastCommit?.oid ?? null);
  }

  /**
   * The push channel is told which repository this tab views when the route
   * changes (A-3.12); not viewing once the screen is left. No cleanup per
   * repository: that would reopen the stream for none in between.
   */
  private viewRepository(): void {
    inject(DestroyRef).onDestroy(() => this.pushChannel.view(null));
  }

  /**
   * An item of the activity bar: another item switches the side pane to it;
   * the selected item, which arrives as `null`, collapses the pane on wide
   * screens and closes the drawer on narrow ones.
   */
  protected selectSideTool(tool: string | null, narrow: boolean): void {
    if (tool === 'files' || tool === 'changes') {
      this.panes.sideTool.set(tool satisfies SideTool);
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

  /** Shows a conflicting file in the editor area (GC-8) and closes the drawer of narrow screens (FB-9). */
  protected selectConflict(path: string): void {
    this.drawerOpen.set(false);
    this.merge.select(path);
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
  protected readonly gitProblems = computed(() => {
    const problem = this.jobs.problem();
    return this.session.state() === 'ready' && problem !== null ? [ problem ] : [];
  });

  /** The merge commit whose notice the user dismissed or pushed from, during this visit. */
  private readonly dismissedMerge = signal<string | null>(null);

  /**
   * Whether "Merge committed. Push to publish it." shows (GC-22). It follows the
   * status, not the commit's answer, so that it also shows after a reload and on
   * another device (AC-GIT-003.11), and goes once the merge commit is pushed, also
   * elsewhere, or is undone. Dismissing it, or **Push**, hides it for the visit.
   */
  protected readonly mergeCommitted = computed(() => {
    const status = this.gitStatus.status();
    return this.session.state() === 'ready'
      && status?.undoableMerge === true
      && !this.merge.merging()
      && status.lastCommit?.oid !== this.dismissedMerge();
  });

  /** The locked key, while the banner for it is shown (RC-15). */
  protected readonly lockedKeyShown = computed(() =>
    this.session.state() === 'ready' && !this.lockedKey.dismissed() ? this.lockedKey.key() : null
  );

  /** The fix of a push or fetch problem (RC-4), through `CredentialFixesService`. */
  protected fixProblem(fix: GitProblem['fix']): void {
    void this.credentialFixes.run(fix);
  }

  /** The fix of the last fetch's problem, from the quiet fetch status in the bar (GA-35, RC-6). */
  protected fixFetchProblem(problem: GitProblemState): void {
    void this.credentialFixes.runFetchFix(problem);
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
    if (found?.kind === 'file') {
      // The backend decides whether it fetches (GA-33); nobody waits for it, so a failure to ask is ignored.
      this.git.fetchOnFileOpened(repositoryId).subscribe({ error: () => undefined });
    }
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
   * has unsaved edits. During a merge, the file is the conflicting file
   * shown (GC-8), without the mark. Until the repository has opened, the
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
      // During a merge, the conflicting file shown, not the hidden one of the route.
      const merging = this.merge.merging();
      const path = merging ? (this.merge.selected() ?? '') : this.path();
      const file = fileName(path);
      const unsaved = !merging && this.unsaved();
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
