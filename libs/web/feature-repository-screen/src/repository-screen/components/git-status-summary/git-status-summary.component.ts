import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  viewChild
} from '@angular/core';
import type { GitStatus } from '@front-burner/shared-contracts';
import { TooltipDirective } from '@front-burner/ui';
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
 * focus, tap or long press (NV-11). Plain text for now: step 4 makes the branch
 * the button that opens the branch list (GA-36).
 */
@Component({
  selector: 'rs-git-status-summary',
  imports: [ TranslocoDirective, TooltipDirective ],
  templateUrl: './git-status-summary.component.html',
  styleUrl: './git-status-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GitStatusSummaryComponent {
  /** The last status read; `null` until one has been read. */
  readonly status = input.required<GitStatus | null>();

  private readonly branchElement = viewChild<ElementRef<HTMLElement>>('branchName');
  private readonly injector = inject(Injector);

  /** Whether the branch name is shortened, so that its full name is in the tooltip. */
  protected readonly shortened = signal(false);

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

  constructor() {
    effect(onCleanup => {
      const element = this.branchElement()?.nativeElement;
      // Measured again for another branch, and as the bar resizes.
      this.status();
      if (!element) {
        return;
      }
      const measure = () => this.shortened.set(element.scrollWidth > element.clientWidth);
      afterNextRender(measure, { injector: this.injector });
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        onCleanup(() => observer.disconnect());
      }
    });
  }
}
