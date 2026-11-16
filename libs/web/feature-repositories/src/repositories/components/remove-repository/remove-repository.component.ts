import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { RepositorySummary } from '@front-burner/shared-contracts';
import { ButtonComponent, DialogService, ToastService } from '@front-burner/ui';
import { DraftStore } from '@front-burner/web-core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

import {
  type RemoveRepositoryData,
  RemoveRepositoryDialog
} from '../../dialogs/remove-repository/remove-repository.dialog';

const KEY = 'web-feature-repositories.RemoveRepositoryComponent';

/**
 * The **Remove repository** section of the settings page (RM-9, RM-17),
 * offered in every status. **Remove repository** opens the confirmation
 * dialog; once it removed the repository, this device's browser drafts of the
 * repository are deleted (RM-19, NF-3.3), without waiting for IndexedDB, and
 * the page goes to the repository management page with "Repository <name>
 * removed." (RM-20). Cancelling changes nothing. The button is busy from the
 * press until the dialog is cancelled or the page has gone, and a press
 * meanwhile does nothing.
 */
@Component({
  selector: 'repo-remove-repository',
  imports: [ TranslocoDirective, ButtonComponent ],
  templateUrl: './remove-repository.component.html',
  styleUrl: './remove-repository.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RemoveRepositoryComponent {
  readonly repository = input.required<RepositorySummary>();

  private readonly dialogs = inject(DialogService);
  private readonly drafts = inject(DraftStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  /** Whether a press has not ended yet: the dialog is open, or the page is going to the list. */
  protected readonly removing = signal(false);

  protected async remove(): Promise<void> {
    if (this.removing()) {
      return;
    }
    this.removing.set(true);
    const { id, name } = this.repository();
    try {
      const ref = this.dialogs.open<RemoveRepositoryDialog, RemoveRepositoryData, boolean>(RemoveRepositoryDialog, {
        data: { id, name }
      });
      if (await firstValueFrom(ref.closed, { defaultValue: undefined }) !== true) {
        return;
      }
      // Not waited for: the repository is gone, so nothing may keep the page from leaving it.
      void this.drafts.deleteRepository(id);
      this.toast.show({
        message: this.transloco.translate(`${KEY}.removed`, { name }),
        dismissLabel: this.transloco.translate(`${KEY}.dismiss`),
        status: 'success'
      });
      await this.router.navigateByUrl('/repositories');
    } finally {
      // Busy until the page has gone, so that a removed repository cannot be removed again.
      this.removing.set(false);
    }
  }
}
