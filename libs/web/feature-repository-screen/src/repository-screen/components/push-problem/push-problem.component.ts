import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import type { PushProblem } from '../../services/push/push.service';
import type { PushFix } from '../../utils/push-problem/push-problem';

/** The fixes with a button so far; plans 60, 63, 64 and 66 add their dialogs' fixes. */
const OFFERED: ReadonlySet<PushFix> = new Set<PushFix>([ 'retry' ]);

/**
 * Why a push failed, below the repository bar and above the panes (NV-16):
 * the message of RC-4, GA-30 or GA-31, the remote's own lines in a `<pre>`, as
 * text (GA-31), and the fix, such as **Try again** (GA-43). It is announced when
 * it appears, unless it is `quiet`, and can be dismissed.
 */
@Component({
  selector: 'rs-push-problem',
  imports: [ TranslocoDirective, ButtonComponent, InlineBannerComponent ],
  templateUrl: './push-problem.component.html',
  styleUrl: './push-problem.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PushProblemComponent {
  readonly problem = input.required<PushProblem>();
  readonly fixSelected = output<PushProblem['fix']>();
  readonly dismissed = output<void>();

  /** The fix to offer, if it has a button yet. */
  protected readonly fix = computed(() => {
    const fix = this.problem().fix;
    return OFFERED.has(fix) ? fix : null;
  });
  protected readonly remoteMessages = computed(() => this.problem().params['remoteMessages']?.trim() || null);
}
