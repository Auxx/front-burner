import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BannerActionsComponent, ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import type { Draft } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * The offer of a browser draft above the editor (ED-7, NF-3.4): "You have
 * unsaved changes from <time>", the time in the browser's locale, with
 * **Restore** and **Discard**, emitted as `restore` and `discard`.
 */
@Component({
  selector: 'rs-draft-offer',
  imports: [ TranslocoDirective, BannerActionsComponent, ButtonComponent, InlineBannerComponent ],
  templateUrl: './draft-offer.component.html',
  styleUrl: './draft-offer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DraftOfferComponent {
  readonly draft = input.required<Draft>();
  readonly restore = output<void>();
  readonly discard = output<void>();

  protected readonly time = computed(() =>
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(this.draft().savedAt)
    )
  );
}
