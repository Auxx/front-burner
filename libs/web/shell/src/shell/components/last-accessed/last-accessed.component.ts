import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TooltipDirective } from '@front-burner/ui';
import { relativeTime } from '@front-burner/web-core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

/**
 * "Last accessed" with the relative time, and the exact time in a tooltip on
 * focus, hover or a tap, wherever repositories are listed (DS-18, RM-5).
 */
@Component({
  selector: 'shell-last-accessed',
  imports: [ TranslocoDirective, TooltipDirective ],
  templateUrl: './last-accessed.component.html',
  styleUrl: './last-accessed.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LastAccessedComponent {
  /** The last access time, as an ISO 8601 string. */
  readonly at = input.required<string>();

  private readonly transloco = inject(TranslocoService);

  private readonly date = computed(() => new Date(this.at()));
  protected readonly relative = computed(() => relativeTime(this.date(), new Date(), this.transloco.getActiveLang()));
  protected readonly exact = computed(() =>
    new Intl.DateTimeFormat(this.transloco.getActiveLang(), { dateStyle: 'medium', timeStyle: 'short' })
      .format(this.date())
  );
}
