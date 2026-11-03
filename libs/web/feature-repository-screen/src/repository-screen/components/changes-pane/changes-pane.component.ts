import { CdkFixedSizeVirtualScroll, CdkVirtualForOf, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import type { GitChange } from '@front-burner/shared-contracts';
import {
  BannerActionsComponent,
  ButtonComponent,
  EmptyStateComponent,
  InlineBannerComponent,
  SpinnerComponent
} from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { GitStatusStore } from '../../services/git-status-store/git-status-store.service';
import { ChangeEntryComponent } from '../change-entry/change-entry.component';

/** Until the probe has been measured: 3 rem at the usual font size. */
const FALLBACK_ROW_HEIGHT = 48;

/**
 * The **Changes** tool window (GA-10 to GA-13): every change of the working
 * copy, sorted by path, in a virtual list, so that 20,000 changes stay usable.
 * A read that failed says so above the last list, and never looks like "No
 * changes".
 */
@Component({
  selector: 'rs-changes-pane',
  imports: [
    CdkFixedSizeVirtualScroll,
    CdkVirtualForOf,
    CdkVirtualScrollViewport,
    TranslocoDirective,
    BannerActionsComponent,
    ButtonComponent,
    EmptyStateComponent,
    InlineBannerComponent,
    SpinnerComponent,
    ChangeEntryComponent
  ],
  templateUrl: './changes-pane.component.html',
  styleUrl: './changes-pane.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChangesPaneComponent {
  protected readonly store = inject(GitStatusStore);

  /** The path of the entry to mark as selected. */
  readonly selected = input<string | null>(null);
  readonly selectPath = output<string>();

  private readonly viewport = viewChild(CdkVirtualScrollViewport);
  private readonly rowProbe = viewChild.required<ElementRef<HTMLElement>>('rowProbe');

  /** In pixels, unrounded, for the virtual list; a row follows the browser's font size. */
  protected readonly rowHeight = signal(FALLBACK_ROW_HEIGHT);

  protected readonly trackChange = (_index: number, change: GitChange) => change.path;

  constructor() {
    // Measured again when shown after `display: none` (a collapsed pane, a closed
    // drawer, the other tool window), and when the font size changes.
    afterRenderEffect(onCleanup => {
      const viewport = this.viewport();
      const probe = this.rowProbe().nativeElement;
      this.measureRowHeight();
      if (typeof ResizeObserver !== 'function') {
        return;
      }
      const observer = new ResizeObserver(() => {
        viewport?.checkViewportSize();
        this.measureRowHeight();
      });
      observer.observe(probe);
      if (viewport) {
        observer.observe(viewport.elementRef.nativeElement);
      }
      onCleanup(() => observer.disconnect());
    });
  }

  /** While hidden, the probe measures 0: the last known height is kept. */
  private measureRowHeight(): void {
    const height = this.rowProbe().nativeElement.getBoundingClientRect().height;
    if (height > 0) {
      this.rowHeight.set(height);
    }
  }
}
