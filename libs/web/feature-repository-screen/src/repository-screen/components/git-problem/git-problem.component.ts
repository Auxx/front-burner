import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import type { GitProblem } from '../../services/network-job/network-job.service';

/**
 * Why a network job failed, below the repository bar and above the panes (NV-16):
 * the message of RC-4, GA-30 or GA-31, the remote's own lines in a `<pre>`, as
 * text (GA-31), the files in the way of a pull, as text, and the fix, such as
 * **Try again** (GA-43). It is announced when
 * it appears, unless it is `quiet`, and can be dismissed.
 */
@Component({
  selector: 'rs-git-problem',
  imports: [ TranslocoDirective, ButtonComponent, InlineBannerComponent ],
  templateUrl: './git-problem.component.html',
  styleUrl: './git-problem.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GitProblemComponent {
  readonly problem = input.required<GitProblem>();
  readonly fixSelected = output<GitProblem['fix']>();
  readonly dismissed = output<void>();

  protected readonly remoteMessages = computed(() => this.problem().params['remoteMessages']?.trim() || null);
  /** The files of a pull that would overwrite them, one per line in its param. */
  protected readonly paths = computed(() =>
    this.problem().params['paths']?.split('\n').filter(path => path !== '') ?? []
  );
}
