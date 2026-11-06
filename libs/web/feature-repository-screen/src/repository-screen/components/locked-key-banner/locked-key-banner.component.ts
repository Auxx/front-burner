import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * Says that the open repository's key is locked, below the repository bar and
 * above the panes (RC-15, NV-16), with **Unlock** (RC-16). It blocks nothing
 * else, is announced once when it appears (RC-25), and can be dismissed.
 */
@Component({
  selector: 'rs-locked-key-banner',
  imports: [ TranslocoDirective, ButtonComponent, InlineBannerComponent ],
  templateUrl: './locked-key-banner.component.html',
  styleUrl: './locked-key-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LockedKeyBannerComponent {
  readonly keyName = input.required<string>();
  readonly unlock = output<void>();
  readonly dismissed = output<void>();
}
