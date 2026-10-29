import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { Entry, EntrySummary } from '@front-burner/shared-contracts';
import {
  ButtonComponent,
  DIALOG_DATA,
  DialogComponent,
  DialogFooterComponent,
  DialogRef,
  InlineBannerComponent,
  SpinnerComponent
} from '@front-burner/ui';
import { FilesApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

/** **Delete** of the entry at `path` (FB-37 to FB-40). */
export interface DeleteEntryData {
  readonly repositoryId: number;
  readonly path: string;
  readonly entry: Entry;
  /** Marks the entry's row as being deleted while the request runs, or clears the mark (FB-40). */
  readonly marked: (deleting: boolean) => void;
}

/** A failed request, as the banner shows it (FB-45). */
interface Failure {
  readonly text: string;
  readonly reference: string | null;
}

/**
 * Asks before deleting an entry (FB-38): its name and, from the entry's
 * summary, what cannot be recovered. A folder says how many files and
 * non-Markdown files it holds; a symbolic link that only the link goes.
 * **Delete** is offered only once the summary is there; if it cannot be had,
 * the dialog shows the error with **Try again**. While the delete runs, the
 * row is marked as deleting; the dialog closes with `true` once it is done,
 * and a failure keeps it open with the error and clears the mark (FB-45).
 */
@Component({
  selector: 'rs-delete-entry',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    DialogComponent,
    DialogFooterComponent,
    InlineBannerComponent,
    SpinnerComponent
  ],
  templateUrl: './delete-entry.dialog.html',
  styleUrl: './delete-entry.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DeleteEntryDialog {
  protected readonly ref = inject<DialogRef<boolean>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as DeleteEntryData;
  private readonly api = inject(FilesApi);
  private readonly errorText = inject(ApiErrorTextService);

  protected readonly summary = signal<EntrySummary | null>(null);
  /** Why the summary could not be had; **Try again** asks again. */
  protected readonly summaryFailure = signal<Failure | null>(null);
  protected readonly failure = signal<Failure | null>(null);
  protected readonly busy = signal(false);

  /** The keys of the messages under the heading, with their parameters. */
  protected readonly messages = computed(() => {
    const summary = this.summary();
    if (!summary) {
      return [];
    }
    switch (this.data.entry.kind) {
      case 'folder':
        return [
          { key: 'folder', params: { files: summary.files, nonMarkdown: summary.nonMarkdown } },
          ...(summary.uncommitted > 0
            ? [ { key: 'uncommittedFolder', params: { uncommitted: summary.uncommitted } } ]
            : [])
        ];
      case 'symlink':
        return [ { key: 'symlink', params: {} } ];
      default:
        return summary.uncommitted > 0 ? [ { key: 'uncommittedFile', params: {} } ] : [];
    }
  });

  constructor() {
    void this.loadSummary();
  }

  protected async loadSummary(): Promise<void> {
    this.summaryFailure.set(null);
    try {
      this.summary.set(await firstValueFrom(this.api.entrySummary(this.data.repositoryId, { path: this.data.path })));
    } catch (error) {
      this.summaryFailure.set(this.errorText.describe(toApiError(error)));
    }
  }

  protected async confirm(): Promise<void> {
    if (this.busy() || !this.summary()) {
      return;
    }
    this.busy.set(true);
    this.ref.dismissible.set(false);
    this.failure.set(null);
    this.data.marked(true);
    try {
      await firstValueFrom(this.api.deleteEntry(this.data.repositoryId, { path: this.data.path }), {
        defaultValue: undefined
      });
      this.ref.close(true);
    } catch (error) {
      this.data.marked(false);
      this.failure.set(this.errorText.describe(toApiError(error)));
    } finally {
      this.busy.set(false);
      this.ref.dismissible.set(true);
    }
  }
}
