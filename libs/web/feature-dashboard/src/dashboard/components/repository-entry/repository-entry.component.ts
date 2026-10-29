import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import { TooltipDirective } from '@front-burner/ui';
import { relativeTime } from '@front-burner/web-core';
import { RepositoryStatusComponent } from '@front-burner/web-shell';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

/**
 * One repository of the recent list (DS-18 to DS-22). Only a ready repository
 * links to the editor; a cloning or failed one links to its settings instead.
 * The confirmation flow (DS-21) is not built yet, so a repository that needs
 * confirmation links nowhere.
 */
@Component({
  selector: 'dash-repository-entry',
  imports: [ TranslocoDirective, RouterLink, TooltipDirective, RepositoryStatusComponent ],
  templateUrl: './repository-entry.component.html',
  styleUrl: './repository-entry.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RepositoryEntryComponent {
  readonly repository = input.required<RepositorySummary>();

  private readonly transloco = inject(TranslocoService);

  protected readonly openable = computed(() => this.repository().status === 'ready');
  protected readonly hasSettingsLink = computed(() =>
    this.repository().status === 'cloning' || this.repository().status === 'error'
  );

  private readonly accessedAt = computed(() => new Date(this.repository().lastAccessedAt));
  protected readonly relative = computed(() =>
    relativeTime(this.accessedAt(), new Date(), this.transloco.getActiveLang())
  );
  protected readonly exact = computed(() =>
    new Intl.DateTimeFormat(this.transloco.getActiveLang(), { dateStyle: 'medium', timeStyle: 'short' })
      .format(this.accessedAt())
  );
}
