import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { BannerActionsComponent, ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * "Merge committed. Push to publish it." with **Push**, below the repository bar
 * and above the panes (GC-22, NV-16), announced when it appears. It can be
 * dismissed. The page decides when it shows. **Undo merge** comes in plan 102.
 */
@Component({
  selector: 'rs-merge-committed',
  imports: [ TranslocoDirective, BannerActionsComponent, ButtonComponent, InlineBannerComponent ],
  templateUrl: './merge-committed.component.html',
  styleUrl: './merge-committed.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MergeCommittedComponent {
  /** **Push** was chosen. */
  readonly push = output<void>();
  readonly dismissed = output<void>();
}
