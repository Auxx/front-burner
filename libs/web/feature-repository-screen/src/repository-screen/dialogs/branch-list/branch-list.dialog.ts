import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import type { GitBranchList } from '@front-burner/shared-contracts';
import {
  BannerActionsComponent,
  ButtonComponent,
  DIALOG_DATA,
  DialogComponent,
  DialogRef,
  FieldComponent,
  IconComponent,
  InlineBannerComponent,
  InputComponent,
  SpinnerComponent
} from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

export interface BranchListData {
  readonly repositoryId: number;
}

/** The branch that was chosen. A remote one's `name` has no `origin/`, as the API wants it (GA-37). */
export interface BranchChoice {
  readonly kind: 'local' | 'remote';
  readonly name: string;
}

type Read =
  | { kind: 'loading'; }
  | { kind: 'failed'; text: string; reference: string | null; }
  | { kind: 'loaded'; branches: GitBranchList; };

/** More would freeze a phone; the filter finds the others. */
const MAX_SHOWN = 200;

/**
 * The branch list (GA-36): the local branches with the current one marked, then
 * the remote branches that have no local branch, and in a single-branch clone a
 * note about what is missing (GA-41). A dialog rather than a menu, since a filter
 * field in a menu breaks the ARIA menu pattern (NV-19), and it works the same way
 * on a phone. It reads the branches each time it opens, so it can't be out of
 * date, and closes with the branch that was chosen, if any.
 *
 * The filter is always shown, and looks for the name as it is listed, ignoring
 * case. Only the first 200 matches are rendered.
 */
@Component({
  selector: 'rs-branch-list',
  imports: [
    TranslocoDirective,
    FormField,
    BannerActionsComponent,
    ButtonComponent,
    DialogComponent,
    FieldComponent,
    IconComponent,
    InlineBannerComponent,
    InputComponent,
    SpinnerComponent
  ],
  templateUrl: './branch-list.dialog.html',
  styleUrl: './branch-list.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BranchListDialog {
  private readonly ref = inject<DialogRef<BranchChoice>>(DialogRef);
  private readonly data = inject(DIALOG_DATA) as BranchListData;
  private readonly api = inject(GitApi);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly filterInput = viewChild.required('filter', { read: ElementRef<HTMLInputElement> });

  protected readonly model = form(signal({ filter: '' }));
  protected readonly read = signal<Read>({ kind: 'loading' });

  /** What the list shows: the branches that match, up to the limit, and how many more there are. */
  protected readonly shown = computed(() => {
    const read = this.read();
    if (read.kind !== 'loaded') {
      return null;
    }
    const wanted = this.model.filter().value().trim().toLowerCase();
    const matches = ({ name }: { name: string; }) => name.toLowerCase().includes(wanted);
    const local = read.branches.local.filter(matches);
    const remote = read.branches.remote.filter(matches);
    return {
      current: read.branches.current,
      singleBranch: read.branches.singleBranch,
      local: local.slice(0, MAX_SHOWN),
      remote: remote.slice(0, Math.max(0, MAX_SHOWN - local.length)),
      hidden: Math.max(0, local.length + remote.length - MAX_SHOWN),
      nothing: local.length + remote.length === 0
    };
  });

  constructor() {
    void this.load();
  }

  protected retry(): void {
    void this.load();
    // **Try again** goes away with the focus on it.
    this.filterInput().nativeElement.focus();
  }

  protected chooseLocal(name: string): void {
    this.ref.close({ kind: 'local', name });
  }

  protected chooseRemote(branch: string): void {
    this.ref.close({ kind: 'remote', name: branch });
  }

  private async load(): Promise<void> {
    this.read.set({ kind: 'loading' });
    try {
      const branches = await firstValueFrom(this.api.gitBranches(this.data.repositoryId));
      this.read.set({ kind: 'loaded', branches });
    } catch (error) {
      this.read.set({ kind: 'failed', ...this.errorText.describe(toApiError(error)) });
    }
  }
}
