import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { RepositoryDetails } from '@front-burner/shared-contracts';
import { KeyValueComponent, KeyValueListComponent, TooltipDirective } from '@front-burner/ui';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

/**
 * The **Clone details** section of the settings page (RM-16), read-only as a
 * key-value list (A-10.50): the clone mode, with the branch of a single-branch
 * clone, the git control level with its description (AR-38), and the day the
 * repository was added, with the exact time in a tooltip on focus, hover or a
 * tap, as "Last accessed" has it.
 */
@Component({
  selector: 'repo-clone-details',
  imports: [ TranslocoDirective, KeyValueListComponent, KeyValueComponent, TooltipDirective ],
  templateUrl: './clone-details.component.html',
  styleUrl: './clone-details.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CloneDetailsComponent {
  readonly details = input.required<RepositoryDetails>();

  private readonly transloco = inject(TranslocoService);

  private readonly added = computed(() => new Date(this.details().addedAt));
  protected readonly addedDay = computed(() =>
    new Intl.DateTimeFormat(this.transloco.getActiveLang(), { dateStyle: 'long' }).format(this.added())
  );
  protected readonly addedExact = computed(() =>
    new Intl.DateTimeFormat(this.transloco.getActiveLang(), { dateStyle: 'medium', timeStyle: 'short' })
      .format(this.added())
  );
}
