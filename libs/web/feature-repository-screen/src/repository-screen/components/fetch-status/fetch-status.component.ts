import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  untracked,
  viewChild
} from '@angular/core';
import type { GitNetworkJobType, GitProblemState } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  IconComponent,
  PopoverComponent,
  TooltipDirective,
  TruncatedTooltipDirective
} from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { fetchProblemFix, gitProblem } from '../../utils/git-problem/git-problem';

const KEY = 'web-feature-repository-screen.FetchStatusComponent';

/**
 * Why fetches aren't working, quietly in the repository bar (GA-35, RC-6):
 * "Couldn't check for remote changes", the reason, the fix of RC-4 and **Try
 * again**. A locked key comes first, as a stored problem is out of date while
 * no fetch runs here: "Unlock _name_ to check for remote changes." and **Unlock**
 * (RC-15). It doesn't say that it couldn't check, since fetches may be running on
 * another session's unlock (RC-20). **Try again** is unavailable while a network
 * job runs (GA-9).
 *
 * It is never an alert: no live region, no focus change and no dialog of its
 * own. On narrow screens nothing of it is in the bar, which has no room for even
 * a button at the smallest widths (NV-11): an item of the git actions menu, whose
 * button then shows a warning icon, calls `openDetails`, which shows all of it in
 * a popover. It goes away once its problem is fixed, so it says when the focus must
 * go elsewhere: as that happens, or before a dialog opens that would give it back.
 */
@Component({
  selector: 'rs-fetch-status',
  imports: [
    NgTemplateOutlet,
    TranslocoDirective,
    ButtonComponent,
    IconComponent,
    PopoverComponent,
    TooltipDirective,
    TruncatedTooltipDirective
  ],
  templateUrl: './fetch-status.component.html',
  styleUrl: './fetch-status.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.narrow]': 'narrow()' }
})
export class FetchStatusComponent {
  /** Why the last fetch failed; `null` when it succeeded or none ran yet. */
  readonly problem = input<GitProblemState | null>(null);
  /** The name of the repository's key while it is locked in this session; `null` otherwise. */
  readonly lockedKeyName = input<string | null>(null);
  /** The network job being started or running, here or in another tab (GA-9). */
  readonly running = input<GitNetworkJobType | null>(null);
  /** Whether the screen uses its narrow layout. */
  readonly narrow = input(false);
  /** **Try again** was chosen while it was offered. */
  readonly retry = output<void>();
  /** The fix of the problem was chosen. */
  readonly fix = output<GitProblemState>();
  /** **Unlock** was chosen. */
  readonly unlock = output<void>();
  /** The focus is in something that may go away: the bar should move it. */
  readonly vacate = output<void>();

  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly details = viewChild(PopoverComponent);
  private readonly detailsElement = viewChild(PopoverComponent, { read: ElementRef });
  /** What opened the panel, which gets the focus back. */
  private anchor: HTMLElement | undefined;

  /** What to say and offer; `null` while there is nothing to say. */
  protected readonly shown = computed(() => {
    const lockedKeyName = this.lockedKeyName();
    if (lockedKeyName !== null) {
      return { reasonKey: `${KEY}.locked`, params: { name: lockedKeyName }, locked: true, fix: null };
    }
    const problem = this.problem();
    if (problem === null) {
      return null;
    }
    return {
      reasonKey: gitProblem(problem.code).messageKey,
      params: problem.params,
      locked: false,
      fix: fetchProblemFix(problem.code)
    };
  });

  /** Whether **Try again** is unavailable. */
  protected readonly busy = computed(() => this.running() !== null);

  constructor() {
    let wasShown = false;
    // Before the template updates, while what has the focus is still there.
    effect(() => {
      const isShown = this.shown() !== null;
      if (wasShown && !isShown && untracked(() => this.hasFocus())) {
        afterNextRender(() => this.vacate.emit(), { injector: this.injector });
      }
      wasShown = isShown;
    });
  }

  /** On narrow screens, shows all of it in a panel next to `anchor`. */
  openDetails(anchor: HTMLElement): void {
    const details = this.details();
    if (details && !details.open()) {
      this.anchor = anchor;
      details.toggle(anchor);
    }
  }

  protected chooseRetry(): void {
    if (!this.busy()) {
      this.closeDetails();
      this.retry.emit();
    }
  }

  protected chooseUnlock(): void {
    this.closeDetails();
    this.vacate.emit();
    this.unlock.emit();
  }

  protected chooseFix(): void {
    const problem = this.problem();
    if (problem !== null) {
      this.closeDetails();
      this.vacate.emit();
      this.fix.emit(problem);
    }
  }

  private hasFocus(): boolean {
    const active = this.document.activeElement;
    return this.host.contains(active) || this.detailsElement()?.nativeElement.contains(active) === true;
  }

  /** On narrow screens, with the focus back on what opened it. */
  private closeDetails(): void {
    this.details()?.open.set(false);
    this.anchor?.focus();
  }
}
