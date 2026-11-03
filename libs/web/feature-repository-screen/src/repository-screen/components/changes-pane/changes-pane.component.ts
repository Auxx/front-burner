import { CdkFixedSizeVirtualScroll, CdkVirtualForOf, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { DOCUMENT } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, inject, input, output, viewChild } from '@angular/core';
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

/** A row's height, as `ChangeEntryComponent`'s style sheet sets it. */
const ROW_REM = 3;
const DEFAULT_ROOT_FONT_PX = 16;

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
  private readonly document = inject(DOCUMENT);

  /** The path of the entry to mark as selected. */
  readonly selected = input<string | null>(null);
  readonly selectPath = output<string>();

  private readonly viewport = viewChild(CdkVirtualScrollViewport);

  /** In pixels, for the virtual list; a row follows the browser's font size. */
  protected readonly rowHeight = ROW_REM * this.rootFontSize();

  protected readonly trackChange = (_index: number, change: GitChange) => change.path;

  constructor() {
    // Measured again when shown after `display: none`: a collapsed pane or a closed drawer.
    afterRenderEffect(onCleanup => {
      const viewport = this.viewport();
      if (!viewport || typeof ResizeObserver !== 'function') {
        return;
      }
      const observer = new ResizeObserver(() => viewport.checkViewportSize());
      observer.observe(viewport.elementRef.nativeElement);
      onCleanup(() => observer.disconnect());
    });
  }

  private rootFontSize(): number {
    const view = this.document.defaultView;
    const size = view ? Number.parseFloat(view.getComputedStyle(this.document.documentElement).fontSize) : Number.NaN;
    return size > 0 ? size : DEFAULT_ROOT_FONT_PX;
  }
}
