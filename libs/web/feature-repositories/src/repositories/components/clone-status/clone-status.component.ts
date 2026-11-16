import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import type { RepositoryDetails } from '@front-burner/shared-contracts';
import { ButtonComponent, CollapsibleComponent, IconComponent, ToastService } from '@front-burner/ui';
import { RepositoryStatusDetailComponent } from '@front-burner/web-shell';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';

const KEY = 'web-feature-repositories.CloneStatusComponent';

let nextId = 0;

/**
 * The **Status** section of the settings page (RM-9), only for a repository
 * that is **Cloning** or in **Error**. While cloning, the clone's progress or
 * "Waiting for other clones to finish", as the lists show it (RM-7, AR-52).
 * In error, the error's label and **Details**, closed by default, with git's
 * error as the backend recorded it, shown as plain text since it may contain
 * text from the remote, and the request ID with **Copy** (RM-10, NF-10.6).
 */
@Component({
  selector: 'repo-clone-status',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    CollapsibleComponent,
    IconComponent,
    RepositoryStatusDetailComponent
  ],
  templateUrl: './clone-status.component.html',
  styleUrl: './clone-status.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.none]': '!shown()' }
})
export class CloneStatusComponent {
  readonly details = input.required<RepositoryDetails>();

  private readonly document = inject(DOCUMENT);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  private readonly id = nextId++;
  protected readonly headingId = `repo-clone-status-heading-${this.id}`;
  protected readonly regionId = `repo-clone-status-details-${this.id}`;
  protected readonly expanded = signal(false);

  protected readonly summary = computed(() => this.details().summary);
  protected readonly shown = computed(() => {
    const status = this.summary().status;
    return status === 'cloning' || status === 'error';
  });
  protected readonly failed = computed(() => this.summary().status === 'error');

  protected toggle(): void {
    this.expanded.update(expanded => !expanded);
  }

  protected async copy(requestId: string): Promise<void> {
    try {
      await this.document.defaultView?.navigator.clipboard.writeText(requestId);
    } catch {
      // Without clipboard access the ID can still be selected and copied by hand.
      return;
    }
    this.toast.show({
      message: this.transloco.translate(`${KEY}.copied`),
      dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
      status: 'success'
    });
  }
}
