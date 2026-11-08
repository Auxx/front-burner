import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, input, output, viewChild } from '@angular/core';
import type { GitProblemState } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  IconButtonComponent,
  IconComponent,
  PopoverComponent,
  PopoverTriggerDirective,
  TruncatedTooltipDirective
} from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { gitProblem } from '../../utils/git-problem/git-problem';

const KEY = 'web-feature-repository-screen.FetchStatusComponent';

/**
 * Why fetches aren't working, quietly in the repository bar (GA-35, RC-6): "Couldn't
 * check for remote changes", the reason, the fix of RC-4 and **Try again**, or
 * **Unlock** for a locked key (RC-15). A locked key comes first: a stored
 * problem is out of date while no fetch runs. It is never an alert: no live
 * region, no focus change and no dialog of its own. On narrow screens it is an
 * icon button, whose tap shows all of it in a popover, so that a long reason
 * cannot push the save status out of the bar (NV-11).
 */
@Component({
  selector: 'rs-fetch-status',
  imports: [
    NgTemplateOutlet,
    TranslocoDirective,
    ButtonComponent,
    IconButtonComponent,
    IconComponent,
    PopoverComponent,
    PopoverTriggerDirective,
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
  /** Whether the screen uses its narrow layout. */
  readonly narrow = input(false);
  /** **Try again** was chosen. */
  readonly retry = output<void>();
  /** The fix of the problem was chosen. */
  readonly fix = output<GitProblemState>();
  /** **Unlock** was chosen. */
  readonly unlock = output<void>();

  private readonly details = viewChild(PopoverComponent);
  private readonly trigger = viewChild('trigger', { read: ElementRef });

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
    const { messageKey, fix } = gitProblem(problem.code);
    // **Try again** is always there, and a locked key is never a stored problem.
    const own = fix === 'retry' || fix === 'unlock' ? null : fix;
    return { reasonKey: messageKey, params: problem.params, locked: false, fix: own };
  });

  protected chooseRetry(): void {
    this.closeDetails();
    this.retry.emit();
  }

  protected chooseUnlock(): void {
    this.closeDetails();
    this.unlock.emit();
  }

  protected chooseFix(): void {
    const problem = this.problem();
    if (problem !== null) {
      this.closeDetails();
      this.fix.emit(problem);
    }
  }

  /** On narrow screens, before a dialog takes the focus and gives it back to where it was. */
  private closeDetails(): void {
    this.details()?.open.set(false);
    this.trigger()?.nativeElement.focus();
  }
}
