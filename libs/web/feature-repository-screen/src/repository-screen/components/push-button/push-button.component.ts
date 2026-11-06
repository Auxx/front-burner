import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { GitStatus } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  IconButtonComponent,
  IconComponent,
  MenuComponent,
  MenuItemComponent,
  MenuTriggerDirective,
  TooltipDirective
} from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/** Why **Push** is not offered, as a message key, or `null` when it is (GA-8). */
export function pushUnavailableReason(status: GitStatus | null): string | null {
  if (status === null) {
    return 'loading';
  }
  if (status.mergeInProgress) {
    return 'merging';
  }
  if (status.branch === null) {
    return 'noBranch';
  }
  if (status.noCommits) {
    return 'noCommits';
  }
  // An unpublished branch, or one whose upstream is gone, is pushed to create it (GA-29).
  if (status.upstream === null || status.upstreamGone) {
    return null;
  }
  return status.ahead > 0 ? null : 'nothingToPush';
}

/**
 * **Push** in the repository bar (GA-7 to GA-9). It is offered when there is
 * something to push or the branch is unpublished; otherwise it is shown
 * unavailable, with the reason on hover, focus or tap, such as "Nothing to push"
 * or "Make a commit first". While a push runs, here or in another tab, it shows a
 * spinner and "Pushing…", which a status region also tells screen readers. On
 * narrow screens it is an item of the git actions menu, with its reason below it
 * (GA-7, NV-11).
 */
@Component({
  selector: 'rs-push-button',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    IconButtonComponent,
    IconComponent,
    MenuComponent,
    MenuItemComponent,
    MenuTriggerDirective,
    TooltipDirective
  ],
  templateUrl: './push-button.component.html',
  styleUrl: './push-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PushButtonComponent {
  /** The last status read; `null` until one has been read. */
  readonly status = input.required<GitStatus | null>();
  /** Whether a push is being started or runs. */
  readonly running = input(false);
  /** Whether the screen uses its narrow layout, where the git actions are in a menu. */
  readonly narrow = input(false);
  /** **Push** was chosen while it was offered. */
  readonly push = output<void>();

  protected readonly reason = computed(() => pushUnavailableReason(this.status()));

  protected choose(): void {
    if (!this.running() && this.reason() === null) {
      this.push.emit();
    }
  }
}
