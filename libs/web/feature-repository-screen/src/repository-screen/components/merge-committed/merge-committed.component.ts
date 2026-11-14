import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { BannerActionsComponent, ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * "Merge committed. Push to publish it." with **Push** and **Undo merge**, below
 * the repository bar and above the panes (GC-22, GC-25, NV-16), announced when it
 * appears. It can be dismissed. The page decides when it shows. While an undo
 * runs, **Undo merge** shows it and neither is offered; while another git action
 * runs, **Undo merge** is not offered, and **Push** waits for it.
 */
@Component({
  selector: 'rs-merge-committed',
  imports: [ TranslocoDirective, BannerActionsComponent, ButtonComponent, InlineBannerComponent ],
  templateUrl: './merge-committed.component.html',
  styleUrl: './merge-committed.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MergeCommittedComponent {
  /** Whether an undo of the merge runs. */
  readonly undoing = input(false);
  /** Whether another git action runs, such as a switch or a network job, which an undo must not race. */
  readonly undoBlocked = input(false);
  /** **Push** was chosen. */
  readonly push = output<void>();
  /** **Undo merge** was chosen. */
  readonly undo = output<void>();
  readonly dismissed = output<void>();
}
