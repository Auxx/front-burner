import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

/** The home page of a logged-in user (REQ-DASH-001); plan 6 adds its sections. */
@Component({
  selector: 'dash-dashboard',
  imports: [ TranslocoDirective ],
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardPage {}
