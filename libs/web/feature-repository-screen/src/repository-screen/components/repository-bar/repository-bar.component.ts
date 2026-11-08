import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  untracked,
  viewChild
} from '@angular/core';
import type {
  CurrentUser,
  GitMergeState,
  GitNetworkJobType,
  GitProblemState,
  GitStatus,
  RepositorySummary
} from '@front-burner/shared-contracts';
import type { SaveStatus } from '@front-burner/web-core';
import { BrandLinkComponent, UserMenuComponent } from '@front-burner/web-shell';

import { FetchStatusComponent } from '../fetch-status/fetch-status.component';
import { GitActionsComponent } from '../git-actions/git-actions.component';
import { GitStatusSummaryComponent } from '../git-status-summary/git-status-summary.component';
import { MergeSummaryComponent } from '../merge-summary/merge-summary.component';
import { RepositorySwitcherComponent } from '../repository-switcher/repository-switcher.component';
import { SaveStatusComponent } from '../save-status/save-status.component';

/**
 * The repository screen's one bar, the app header and the repository's header
 * in one (NV-9, FB-10): the product's icon as a link to the dashboard, the
 * repository name, which opens the repository switcher (NV-10), the current
 * branch and its counts and **Fetch** and **Push** (GA-7), or during a merge what merges and **Abort merge**
 * (GC-6), why fetches aren't working, quietly (GA-35), the open file's save status (ED-18), and the user menu. The
 * **Files** toggle is in the activity bar (FB-7, FB-9).
 */
@Component({
  selector: 'rs-repository-bar',
  imports: [
    BrandLinkComponent,
    UserMenuComponent,
    RepositorySwitcherComponent,
    GitStatusSummaryComponent,
    GitActionsComponent,
    MergeSummaryComponent,
    FetchStatusComponent,
    SaveStatusComponent
  ],
  templateUrl: './repository-bar.component.html',
  styleUrl: './repository-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositoryBarComponent {
  readonly repository = input.required<RepositorySummary>();
  /** The logged-in user, once loaded. */
  readonly user = input<CurrentUser>();
  /** Whether there is a file tree to show; not for a repository that cannot be opened (FB-3). */
  readonly withFiles = input(true);
  /** Whether the screen uses its narrow layout. */
  readonly narrow = input(false);
  /** The last git status read; `null` until one has been read. */
  readonly gitStatus = input<GitStatus | null>(null);
  /** The open file's save status; `null` without one. */
  readonly saveStatus = input<SaveStatus | null>(null);
  /** The network job being started or running, here or in another tab (GA-9). */
  readonly running = input<GitNetworkJobType | null>(null);
  /** The name of the repository's key while it is locked in this session (RC-15). */
  readonly lockedKeyName = input<string | null>(null);
  /** Whether a merge is in progress, which replaces the git status and actions (GC-6). */
  readonly merging = input(false);
  /** The merge in progress; `null` until it has been read. */
  readonly mergeState = input<GitMergeState | null>(null);
  /** Whether an abort of the merge is running. */
  readonly aborting = input(false);
  /** **Abort merge** was chosen. */
  readonly abortMerge = output<void>();
  /** **Fetch** was chosen. */
  readonly fetch = output<void>();
  /** **Push** was chosen. */
  readonly push = output<void>();
  /** **Try again** was chosen in the quiet fetch status. */
  readonly retryFetch = output<void>();
  /** The fix of the last fetch's problem was chosen in the quiet fetch status. */
  readonly fixFetch = output<GitProblemState>();
  /** **Unlock** was chosen in the quiet fetch status. */
  readonly unlock = output<void>();

  private readonly gitActions = viewChild(GitActionsComponent);
  private readonly mergeSummary = viewChild(MergeSummaryComponent);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  constructor() {
    this.keepFocusWhenActionsSwap();
  }

  /**
   * A merge starting or ending, also elsewhere, replaces what offers the git
   * actions. This runs before the bar shows it, so what is focused is still there.
   */
  private keepFocusWhenActionsSwap(): void {
    let wasMerging = this.merging();
    effect(() => {
      const merging = this.merging();
      if (merging !== wasMerging && untracked(() => this.actionsHaveFocus())) {
        afterNextRender(() => this.focusActions(), { injector: this.injector });
      }
      wasMerging = merging;
    });
  }

  private actionsHaveFocus(): boolean {
    return this.host.querySelector('rs-merge-summary, rs-git-actions')?.contains(this.document.activeElement) === true;
  }

  /** Gives the focus to what offers the git actions, when what had it in the bar went away. */
  protected focusActions(): void {
    (this.mergeSummary() ?? this.gitActions())?.focus();
  }
}
