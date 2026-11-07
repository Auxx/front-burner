import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import type { PushProblem } from '../../services/push/push.service';

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

  protected readonly fix = computed(() => this.problem().fix);
  protected readonly remoteMessages = computed(() => this.problem().params['remoteMessages']?.trim() || null);
}
