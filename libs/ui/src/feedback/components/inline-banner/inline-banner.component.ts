import { LiveAnnouncer } from '@angular/cdk/a11y';
import {
  afterNextRender,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  viewChild
} from '@angular/core';

import { IconComponent } from '../../../content/components/icon/icon.component';
import { IconButtonComponent } from '../../../controls/components/icon-button/icon-button.component';
import { type Status } from '../../models/status.model';
import { StatusIconComponent } from '../status-icon/status-icon.component';

/**
 * A notice about a state that lasts, shown where it applies: a global banner
 * below the app header (NV-15), a page's notice such as the locked-key banner
 * (RC-15), or a quiet line such as the preview's removed-HTML notice
 * (`quiet`, SH-17). Actions go in an element marked `uiBannerActions`.
 *
 * With a `dismissLabel` it shows a dismiss button that emits `dismissed`; the
 * owner removes the banner, since what dismissing means differs between
 * banners. With `announce` its message is announced once, politely, when it
 * appears (RC-25); otherwise it is never announced (SH-20). It has no live
 * region, so changes to its content are not announced either.
 */
@Component({
  selector: 'ui-inline-banner',
  imports: [ IconButtonComponent, IconComponent, StatusIconComponent ],
  templateUrl: './inline-banner.component.html',
  styleUrl: './inline-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-status]': 'status()',
    '[attr.data-quiet]': 'quiet() || null'
  }
})
export class InlineBannerComponent {
  readonly status = input<Status>('info');
  readonly quiet = input(false, { transform: booleanAttribute });
  readonly dismissLabel = input<string>();
  readonly announce = input(false, { transform: booleanAttribute });
  readonly dismissed = output<void>();

  private readonly message = viewChild.required<ElementRef<HTMLElement>>('message');

  constructor() {
    const announcer = inject(LiveAnnouncer);
    afterNextRender(() => {
      if (this.announce()) {
        const text = this.message().nativeElement.textContent?.replace(/\s+/g, ' ').trim();
        if (text) {
          void announcer.announce(text, 'polite');
        }
      }
    });
  }
}
