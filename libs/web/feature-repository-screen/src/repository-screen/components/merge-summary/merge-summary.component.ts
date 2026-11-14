import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output } from '@angular/core';
import type { GitMergeState } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  IconButtonComponent,
  IconComponent,
  MenuComponent,
  MenuItemComponent,
  MenuTriggerDirective,
  TooltipDirective,
  TruncatedTooltipDirective
} from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * The merge in progress in the repository bar, in place of the git status and
 * actions (GC-6, GA-4): "Merging origin/main into main", "2 of 3 files resolved"
 * with **Commit merge** (GC-20) and **Abort merge** (GC-23). **Commit merge** is
 * unavailable until every file is resolved, with "Resolve every file first" on
 * hover, focus or tap (GA-8), and while an abort runs; a merge with no
 * conflicting file left is ready at once. On narrow screens the count stays, the names give up their room first,
 * with each full name on hover, focus, tap or long press, and both actions are in
 * a git actions menu (GA-7, NV-11). Until the merge has been read, it says only
 * that one is in progress, and can still be aborted.
 */
@Component({
  selector: 'rs-merge-summary',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    IconButtonComponent,
    IconComponent,
    MenuComponent,
    MenuItemComponent,
    MenuTriggerDirective,
    TooltipDirective,
    TruncatedTooltipDirective
  ],
  templateUrl: './merge-summary.component.html',
  styleUrl: './merge-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MergeSummaryComponent {
  /** The merge in progress; `null` until it has been read. */
  readonly state = input.required<GitMergeState | null>();
  /** Whether the screen uses its narrow layout, where **Abort merge** is in a menu. */
  readonly narrow = input(false);
  /** Whether an abort is running. */
  readonly busy = input(false);
  /** What the narrow menu warns of, and its button shows that it does, such as a failed fetch (GA-35); `null` without one. */
  readonly warning = input<string | null>(null);
  /** **Abort merge** was chosen. */
  readonly abortMerge = output<void>();
  /** **Commit merge** was chosen, with every file resolved. */
  readonly commit = output<void>();
  /** The warning was chosen in the narrow menu. */
  readonly showWarning = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly resolved = computed(() => this.state()?.files.filter(file => file.resolved).length ?? 0);
  /** Whether **Commit merge** is on offer: the merge has been read, and every file is resolved (GC-20). */
  protected readonly ready = computed(() => {
    const merge = this.state();
    return merge !== null && this.resolved() === merge.files.length;
  });

  /** An item of the narrow menu was chosen. */
  protected choose(item: unknown): void {
    if (item === 'warning') {
      this.showWarning.emit();
    } else if (item === 'commit') {
      this.commit.emit();
    } else {
      this.abortMerge.emit();
    }
  }

  /** Takes the focus, such as when what had it in the bar went away. */
  focus(): void {
    this.host.querySelector('button')?.focus();
  }
}
