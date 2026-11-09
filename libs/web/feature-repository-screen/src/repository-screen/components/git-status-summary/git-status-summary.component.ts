import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { GitStatus } from '@front-burner/shared-contracts';
import { TruncatedTooltipDirective } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/** What follows the branch: a message key and its parameters, or nothing. */
type Detail = { key: string; params: Record<string, number>; } | null;

/**
 * The current branch and its counts in the repository bar (GA-7, NV-9): "main ·
 * 2 to push, 3 to pull", nothing after the branch when both are zero, "Not
 * published" for a branch without an upstream, "main · no commits yet" in a
 * repository without commits (GA-42), and "No branch" for a detached `HEAD`.
 * Empty until the first status has loaded. A branch name too long for the bar
 * is shortened with an ellipsis, and its full name is in a tooltip, on hover,
 * focus or long press (NV-11). The branch is the button that opens the branch
 * list (GA-7, GA-36), also without a branch, as the list is the way back to one.
 */
@Component({
  selector: 'rs-git-status-summary',
  imports: [ TranslocoDirective, TruncatedTooltipDirective ],
  templateUrl: './git-status-summary.component.html',
  styleUrl: './git-status-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GitStatusSummaryComponent {
  /** The last status read; `null` until one has been read. */
  readonly status = input.required<GitStatus | null>();
  /** Whether a switch is on its way: the button says so, and keeps the focus. */
  readonly switching = input(false);
  /** The branch was chosen, to open the branch list. */
  readonly openBranches = output<void>();

  protected readonly detail = computed((): Detail => {
    const status = this.status();
    if (!status || status.branch === null) {
      return null;
    }
    if (status.noCommits) {
      return { key: 'noCommits', params: {} };
    }
    if (status.upstream === null) {
      return { key: 'notPublished', params: {} };
    }
    const { ahead, behind } = status;
    if (ahead && behind) {
      return { key: 'toPushAndPull', params: { ahead, behind } };
    }
    if (ahead) {
      return { key: 'toPush', params: { ahead } };
    }
    return behind ? { key: 'toPull', params: { behind } } : null;
  });
}
