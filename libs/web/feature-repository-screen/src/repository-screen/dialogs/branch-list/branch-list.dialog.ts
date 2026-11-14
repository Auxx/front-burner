import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { form, FormField } from '@angular/forms/signals';
import type { GitBranchList, GitLocalBranch } from '@front-burner/shared-contracts';
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
  SpinnerComponent,
  TooltipDirective
} from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { ApiErrorTextService, toApiError } from '@front-burner/web-core';
import { TranslocoDirective } from '@jsverse/transloco';

export interface BranchListData {
  readonly repositoryId: number;
  readonly noCommits?: boolean;
  /** Whether the backend says that the last merge can still be undone (GC-25): **Undo merge** is offered. */
  readonly undoableMerge?: boolean;
}

/**
 * The branch that was chosen. A remote one's `name` has no `origin/`, as the API
 * wants it (GA-37). `undo-merge` is **Undo merge** (GC-25).
 */
export type BranchChoice =
  | { readonly kind: 'local'; readonly name: string; }
  | { readonly kind: 'remote'; readonly name: string; }
  | { readonly kind: 'new'; }
  | { readonly kind: 'undo-merge'; };

type Read =
  | { kind: 'loading'; }
  | { kind: 'failed'; text: string; reference: string | null; }
  | { kind: 'loaded'; branches: GitBranchList; };

/** More would freeze a phone; the filter finds the others. */
const MAX_SHOWN = 200;
/** How many of those rows local branches leave to remote ones, so that many local ones don't hide them all. */
const REMOTE_ROOM = 50;

/** The first `count` branches, the last being the current one when it comes later, so that it is always marked (GA-36). */
function firstWithCurrent(
  branches: readonly GitLocalBranch[],
  count: number,
  current: string | null
): readonly GitLocalBranch[] {
  const index = branches.findIndex(branch => branch.name === current);
  return index >= count ? [ ...branches.slice(0, count - 1), branches[index] ] : branches.slice(0, count);
}

/**
 * The branch list (GA-36): the local branches with the current one marked, then
 * the remote branches that have no local branch, and in a single-branch clone a
 * note about what is missing (GA-41). Above them, **New branch**, and **Undo
 * merge** while the last merge can be undone (GC-25). A dialog rather than a menu, since a filter
 * field in a menu breaks the ARIA menu pattern (NV-19), and it works the same way
 * on a phone. It reads the branches each time it opens, so it can't be out of
 * date, and closes with the branch that was chosen, if any and if it is not the
 * current one.
 *
 * The filter is always shown, and looks for the name as it is listed, ignoring
 * case. Only 200 matches are rendered: the first ones by name, always with the
 * current branch and with room for remote branches.
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
    SpinnerComponent,
    TooltipDirective
  ],
  templateUrl: './branch-list.dialog.html',
  styleUrl: './branch-list.dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BranchListDialog {
  private readonly ref = inject<DialogRef<BranchChoice>>(DialogRef);
  protected readonly data = inject(DIALOG_DATA) as BranchListData;
  private readonly api = inject(GitApi);
  private readonly errorText = inject(ApiErrorTextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly filterInput = viewChild.required('filter', { read: ElementRef<HTMLInputElement> });

  protected readonly model = form(signal({ filter: '' }));
  protected readonly read = signal<Read>({ kind: 'loading' });

  /** What the list shows: the branches that match, up to the limit, how many more there are, and why there are none. */
  protected readonly shown = computed(() => {
    const read = this.read();
    if (read.kind !== 'loaded') {
      return null;
    }
    const { branches } = read;
    const wanted = this.model.filter().value().trim().toLowerCase();
    const matches = ({ name }: { name: string; }) => name.toLowerCase().includes(wanted);
    const matchingLocal = branches.local.filter(matches);
    const matchingRemote = branches.remote.filter(matches);
    const total = matchingLocal.length + matchingRemote.length;
    const local = firstWithCurrent(
      matchingLocal,
      MAX_SHOWN - Math.min(matchingRemote.length, REMOTE_ROOM),
      branches.current
    );
    const remote = matchingRemote.slice(0, MAX_SHOWN - local.length);
    const none = branches.local.length + branches.remote.length === 0 ? 'noBranches' : 'noMatches';
    return {
      current: branches.current,
      singleBranch: branches.singleBranch,
      local,
      remote,
      hidden: total - local.length - remote.length,
      empty: total === 0 ? none : null
    };
  });

  constructor() {
    this.load();
  }

  protected retry(): void {
    this.load();
    // **Try again** goes away with the focus on it.
    this.filterInput().nativeElement.focus();
  }

  protected chooseNew(): void {
    if (this.data.noCommits) {
      return;
    }
    this.ref.close({ kind: 'new' });
  }

  protected chooseUndoMerge(): void {
    this.ref.close({ kind: 'undo-merge' });
  }

  /** The current branch as this read has it, which the status may not know yet: there is nothing to switch to. */
  protected chooseLocal(name: string): void {
    this.ref.close(name === this.shown()?.current ? undefined : { kind: 'local', name });
  }

  protected chooseRemote(branch: string): void {
    this.ref.close({ kind: 'remote', name: branch });
  }

  /** Ends with the dialog, so that closing it leaves no read running. */
  private load(): void {
    this.read.set({ kind: 'loading' });
    this.api.gitBranches(this.data.repositoryId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: branches => this.read.set({ kind: 'loaded', branches }),
        error: (error: unknown) => this.read.set({ kind: 'failed', ...this.errorText.describe(toApiError(error)) })
      });
  }
}
