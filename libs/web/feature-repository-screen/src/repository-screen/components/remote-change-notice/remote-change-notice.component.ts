import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import type { RemoteChangeNotice } from '../../services/remote-changes/remote-changes.service';

/**
 * Says that the upstream has new commits, below the repository bar and above the
 * panes (GA-34, NV-16), and whether they change the open file, with **Pull**. It
 * is announced once when it appears, if it says something new, and can be
 * dismissed. **Pull** shows that it waits, while another network job ends.
 */
@Component({
  selector: 'rs-remote-change-notice',
  imports: [ TranslocoDirective, ButtonComponent, InlineBannerComponent ],
  templateUrl: './remote-change-notice.component.html',
  styleUrl: './remote-change-notice.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RemoteChangeNoticeComponent {
  readonly notice = input.required<RemoteChangeNotice>();
  /** A press of **Pull** waits for the running network job to end. */
  readonly waiting = input(false);
  readonly pull = output<void>();
  readonly dismissed = output<void>();
}
