import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import type { GitChangeState, GitDiff } from '@front-burner/shared-contracts';
import { isMarkdownName } from '@front-burner/shared-util';
import { BannerActionsComponent, ButtonComponent, InlineBannerComponent, SpinnerComponent } from '@front-burner/ui';
import { GitApi } from '@front-burner/web-api-client';
import { TranslocoDirective } from '@jsverse/transloco';

import { GitStatusStore } from '../../services/git-status-store/git-status-store.service';
import {
  type DiffRow,
  diffRows,
  type FoldRange,
  foldsOverlap,
  sameDiff,
  wholeLineRow
} from '../../utils/diff-rows/diff-rows';
import { formatSize } from '../../utils/file-size/file-size';

/** The rows rendered at a time: a diff can hold 100,000 lines, which would hang the tab, above all on a phone. */
export const DIFF_ROW_BATCH = 2000;

/** The old lines a fold hides, for a fold that hides any. */
function foldRange(row: DiffRow & { kind: 'fold'; }): FoldRange | null {
  const from = row.hidden[0]?.oldLine;
  const to = row.hidden.at(-1)?.oldLine;
  return from && to ? { from, to } : null;
}

/**
 * A changed file's unified diff, in the editor area (GA-14 to GA-16): line
 * numbers of both versions, a sign on each changed line and a `<mark>` on each
 * changed word, so that colour is never the only signal (NF-13.7). Lines are
 * text, bound by Angular, and scroll inside the diff.
 *
 * It reads the diff when the path changes, and again whenever `GitStatusStore`
 * has read a new status, which is at once on `git.changed`, so that a file
 * committed elsewhere never shows stale lines. Only the latest read counts.
 * While a new read of the same file runs, its lines stay in place, and an
 * answer equal to the last one builds nothing again. A long diff renders its
 * first rows, and more on request.
 */
@Component({
  selector: 'rs-diff-view',
  imports: [ TranslocoDirective, BannerActionsComponent, ButtonComponent, InlineBannerComponent, SpinnerComponent ],
  templateUrl: './diff-view.component.html',
  styleUrl: './diff-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DiffViewComponent {
  private readonly api = inject(GitApi);
  private readonly status = inject(GitStatusStore);

  readonly repositoryId = input.required<number>();
  readonly path = input.required<string>();
  readonly state = input.required<GitChangeState>();
  /** Keeps it from reading, such as while the open file's save is on its way, so that the diff has it. */
  readonly waiting = input(false);
  readonly openInEditor = output<string>();

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  private readonly loaded = signal<{ path: string; diff: GitDiff; } | null>(null);
  /** Changed by **Try again**, to read again. */
  private readonly attempt = signal(0);
  /** The folds opened. A fold stays open while it shares lines with one, as changes above it move its start. */
  private readonly openedFolds = signal<readonly FoldRange[]>([]);
  /** How many rows are rendered. */
  private readonly rowLimit = signal(DIFF_ROW_BATCH);
  /** The path of the last read, to start afresh for another one. */
  private requestedPath: string | null = null;

  protected readonly failed = signal(false);
  /** The path's diff; `null` until its first read has answered, never another file's. */
  protected readonly diff = computed(() => {
    const loaded = this.loaded();
    return loaded?.path === this.path() ? loaded.diff : null;
  });
  protected readonly textDiff = computed(() => {
    const diff = this.diff();
    return diff?.kind === 'text' ? diff : null;
  });
  protected readonly binarySizes = computed(() => {
    const diff = this.diff();
    return diff?.kind === 'binary'
      ? {
        old: diff.oldSize === null ? null : formatSize(diff.oldSize),
        new: diff.newSize === null ? null : formatSize(diff.newSize)
      }
      : null;
  });
  /** Whether the last status lists the file: when it does not, the file may no longer exist. */
  private readonly listed = computed(() =>
    this.status.status()?.changes.some(change => change.path === this.path()) ?? false
  );
  /** A Markdown file that exists (GA-15). */
  protected readonly canOpen = computed(() =>
    this.listed() && this.state() !== 'deleted' && isMarkdownName(this.path())
  );
  /**
   * Why a diff has no lines: the changes are gone, or git has no lines for the
   * change, for an empty file or a new file mode.
   */
  protected readonly noLinesMessage = computed(() => {
    if (!this.listed()) {
      return 'noChanges';
    }
    return this.state() === 'modified' ? 'noContentChanges' : 'emptyFile';
  });

  private readonly allRows = computed(() => {
    const diff = this.textDiff();
    return diff ? diffRows(diff.lines, diff.complete) : [];
  });
  /** Every row: an opened fold shows its lines in its place. */
  private readonly rowsWithOpenFolds = computed<DiffRow[]>(() => {
    const opened = this.openedFolds();
    return this.allRows().flatMap(row => {
      const range = row.kind === 'fold' ? foldRange(row) : null;
      return row.kind === 'fold' && range && opened.some(other => foldsOverlap(range, other))
        ? row.hidden.map(wholeLineRow)
        : [ row ];
    });
  });
  /** The rows rendered. */
  protected readonly rows = computed(() => this.rowsWithOpenFolds().slice(0, this.rowLimit()));
  protected readonly totalRows = computed(() => this.rowsWithOpenFolds().length);
  /** How many rows **Show more** adds; 0 when every row is rendered. */
  protected readonly nextRows = computed(() => Math.min(DIFF_ROW_BATCH, this.totalRows() - this.rows().length));

  constructor() {
    effect(onCleanup => {
      const repositoryId = this.repositoryId();
      const path = this.path();
      this.status.status();
      this.attempt();
      if (this.waiting()) {
        return;
      }
      const request = untracked(() => {
        if (this.requestedPath !== path) {
          this.requestedPath = path;
          this.openedFolds.set([]);
          this.rowLimit.set(DIFF_ROW_BATCH);
          this.failed.set(false);
        }
        return this.api.diff(repositoryId, { path }).subscribe({
          next: diff => this.answered(path, diff),
          error: () => this.failed.set(true)
        });
      });
      onCleanup(() => request.unsubscribe());
    });
  }

  protected retry(): void {
    this.attempt.update(attempt => attempt + 1);
  }

  /** Opens a fold in place; its button goes away, so the focus stays in the diff. */
  protected openFold(row: DiffRow & { kind: 'fold'; }): void {
    const range = foldRange(row);
    if (range) {
      this.openedFolds.update(opened => [ ...opened, range ]);
    }
    this.scroller()?.nativeElement.focus({ preventScroll: true });
  }

  /** Renders the next rows; once the button goes away, the focus stays in the diff. */
  protected showNextRows(): void {
    this.rowLimit.update(limit => limit + DIFF_ROW_BATCH);
    if (this.nextRows() === 0) {
      this.scroller()?.nativeElement.focus({ preventScroll: true });
    }
  }

  private answered(path: string, diff: GitDiff): void {
    this.failed.set(false);
    const loaded = this.loaded();
    if (loaded?.path === path && sameDiff(loaded.diff, diff)) {
      return;
    }
    this.loaded.set({ path, diff });
    // Folds that are gone are forgotten, so that they are closed if they come back.
    const folds = this.allRows().flatMap(row => {
      const range = row.kind === 'fold' ? foldRange(row) : null;
      return range ? [ range ] : [];
    });
    this.openedFolds.update(opened => opened.filter(range => folds.some(fold => foldsOverlap(range, fold))));
  }
}
