import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output } from '@angular/core';
import type { GitNetworkJobType, GitStatus } from '@front-burner/shared-contracts';
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

import {
  fetchUnavailableReason,
  pullUnavailableReason,
  pushUnavailableReason
} from '../../utils/git-action-reasons/git-action-reasons';

/**
 * **Fetch**, **Pull** and **Push** in the repository bar (GA-7 to GA-9). Each is
 * offered when it can run; otherwise it is shown unavailable, with the reason on
 * hover, focus or tap, such as "Nothing to push", "Make a commit first" or "Another
 * git action is running". While a network job runs, here or in another tab, its
 * button shows a spinner and "Fetching…", "Pulling…" or "Pushing…", which a status
 * region also tells screen readers, and the others are unavailable (GA-9). On narrow
 * screens they are items of the git actions menu, with their reasons below
 * them (GA-7, NV-11).
 */
@Component({
  selector: 'rs-git-actions',
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
  templateUrl: './git-actions.component.html',
  styleUrl: './git-actions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GitActionsComponent {
  /** The last status read; `null` until one has been read. */
  readonly status = input.required<GitStatus | null>();
  /** The network job being started or running, here or in another tab; `null` without one. */
  readonly running = input<GitNetworkJobType | null>(null);
  /** Whether the screen uses its narrow layout, where the git actions are in a menu. */
  readonly narrow = input(false);
  /** What the narrow menu warns of, and its button shows that it does, such as a failed fetch (GA-35); `null` without one. */
  readonly warning = input<string | null>(null);
  /** The warning was chosen in the narrow menu. */
  readonly showWarning = output<void>();
  /** **Fetch** was chosen while it was offered. */
  readonly fetch = output<void>();
  /** **Pull** was chosen while it was offered. */
  readonly pull = output<void>();
  /** **Push** was chosen while it was offered. */
  readonly push = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly fetching = computed(() => this.running() === 'fetch');
  protected readonly pulling = computed(() => this.running() === 'pull');
  protected readonly pushing = computed(() => this.running() === 'push');

  /** The message key of what runs, for the status region; `null` while nothing runs. */
  protected readonly progress = computed(() => {
    const running = this.running();
    return running === null ? null : `${running}ing`;
  });

  /** Why **Fetch** is unavailable, as a message key, or `null`; none while it runs. */
  protected readonly fetchReason = computed(() =>
    this.fetching() ? null : (fetchUnavailableReason(this.status()) ?? this.busyReason())
  );
  /** Why **Pull** is unavailable, as a message key, or `null`; none while it runs. */
  protected readonly pullReason = computed(() =>
    this.pulling() ? null : (pullUnavailableReason(this.status()) ?? this.busyReason())
  );
  /** Why **Push** is unavailable, as a message key, or `null`; none while it runs. */
  protected readonly pushReason = computed(() =>
    this.pushing() ? null : (pushUnavailableReason(this.status()) ?? this.busyReason())
  );

  /** Takes the focus, such as when what had it in the bar went away. */
  focus(): void {
    this.host.querySelector('button')?.focus();
  }

  private busyReason(): string | null {
    return this.running() === null ? null : 'busy';
  }

  /** An item of the narrow menu was chosen. */
  protected choose(item: unknown): void {
    if (item === 'fetch') {
      this.chooseFetch();
    } else if (item === 'pull') {
      this.choosePull();
    } else if (item === 'push') {
      this.choosePush();
    } else if (item === 'warning') {
      this.showWarning.emit();
    }
  }

  protected chooseFetch(): void {
    if (this.fetchReason() === null && !this.fetching()) {
      this.fetch.emit();
    }
  }

  protected choosePull(): void {
    if (this.pullReason() === null && !this.pulling()) {
      this.pull.emit();
    }
  }

  protected choosePush(): void {
    if (this.pushReason() === null && !this.pushing()) {
      this.push.emit();
    }
  }
}
