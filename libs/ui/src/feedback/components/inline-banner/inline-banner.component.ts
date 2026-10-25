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

import { IconButtonComponent } from '../../../controls/components/icon-button/icon-button.component';
import { type Status } from '../../models/status.model';
import { StatusIconComponent } from '../status-icon/status-icon.component';

// Codicon `close` (CC-BY-4.0), inline until the Icon component exists.
const close =
  'M8.70701 8.00001L12.353 4.35401C12.548 4.15901 12.548 3.84201 12.353 3.64701C12.158 3.45201 11.841 3.45201 11.646 3.64701L8.00001 7.29301L4.35401 3.64701C4.15901 3.45201 3.84201 3.45201 3.64701 3.64701C3.45201 3.84201 3.45201 4.15901 3.64701 4.35401L7.29301 8.00001L3.64701 11.646C3.45201 11.841 3.45201 12.158 3.64701 12.353C3.74501 12.451 3.87301 12.499 4.00101 12.499C4.12901 12.499 4.25701 12.45 4.35501 12.353L8.00101 8.70701L11.647 12.353C11.745 12.451 11.873 12.499 12.001 12.499C12.129 12.499 12.257 12.45 12.355 12.353C12.55 12.158 12.55 11.841 12.355 11.646L8.70901 8.00001H8.70701Z';

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
  imports: [ IconButtonComponent, StatusIconComponent ],
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

  protected readonly close = close;

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
