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
import { type DiffRow, diffRows, wholeLineRow } from '../../utils/diff-rows/diff-rows';

const BYTES_PER_UNIT = 1024;

/** A size in bytes, in the largest unit that keeps it above 1. */
function formatSize(bytes: number): string {
  if (bytes < BYTES_PER_UNIT) {
    return `${bytes} B`;
  }
  const kilobytes = bytes / BYTES_PER_UNIT;
  const [ value, unit ] = kilobytes < BYTES_PER_UNIT ? [ kilobytes, 'KB' ] : [ kilobytes / BYTES_PER_UNIT, 'MB' ];
  return `${Number(value.toFixed(1))} ${unit}`;
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
 * While a new read of the same file runs, its lines stay in place.
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
  readonly openInEditor = output<string>();

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  private readonly loaded = signal<{ path: string; diff: GitDiff; } | null>(null);
  /** Changed by **Try again**, to read again. */
  private readonly attempt = signal(0);
  /** The folds opened, by the line number of their first hidden line. */
  private readonly openedFolds = signal<ReadonlySet<number>>(new Set());

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
  /** A Markdown file that exists (GA-15). */
  protected readonly canOpen = computed(() => this.state() !== 'deleted' && isMarkdownName(this.path()));

  private readonly allRows = computed(() => diffRows(this.textDiff()?.lines ?? []));
  /** The rows to show: an opened fold shows its lines in its place. */
  protected readonly rows = computed<DiffRow[]>(() => {
    const opened = this.openedFolds();
    return this.allRows().flatMap(row => {
      const first = row.kind === 'fold' ? row.hidden[0]?.oldLine : null;
      return row.kind === 'fold' && first && opened.has(first) ? row.hidden.map(wholeLineRow) : [ row ];
    });
  });

  constructor() {
    effect(onCleanup => {
      const repositoryId = this.repositoryId();
      const path = this.path();
      this.status.status();
      this.attempt();
      const request = untracked(() => {
        if (this.loaded()?.path !== path) {
          this.openedFolds.set(new Set());
          this.failed.set(false);
        }
        return this.api.diff(repositoryId, { path }).subscribe({
          next: diff => {
            this.loaded.set({ path, diff });
            this.failed.set(false);
          },
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
    const first = row.hidden[0].oldLine;
    if (first !== null) {
      this.openedFolds.update(opened => new Set(opened).add(first));
    }
    this.scroller()?.nativeElement.focus({ preventScroll: true });
  }
}
