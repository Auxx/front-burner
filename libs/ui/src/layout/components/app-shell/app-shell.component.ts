import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  ElementRef,
  input,
  model,
  viewChild
} from '@angular/core';

import { AppShellSideDirective } from '../../directives/app-shell-side/app-shell-side.directive';
import { injectNarrowViewport } from '../../utils/narrow-viewport/narrow-viewport.util';
import { SplitPaneComponent, SplitPaneShow } from '../split-pane/split-pane.component';

/**
 * The layout of every page that needs a login (A-10.5, A-10.6): the header, an
 * optional activity bar and side panel, the main content and an optional status
 * bar, on the canvas.
 *
 * On wide screens the side panel is beside the content and can be resized and
 * collapsed. On narrow screens it is a drawer shown instead of the content: it
 * takes the focus when it opens, `Escape` closes it, and the focus goes back to
 * where it was.
 */
@Component({
  selector: 'ui-app-shell',
  imports: [ SplitPaneComponent ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown.escape)': 'onEscape($event)'
  }
})
export class AppShellComponent {
  /** The text of the skip link to the main content (NV-17). */
  readonly skipLinkLabel = input.required<string>();
  /** Whether the side panel is shown: beside the content, or as the drawer. */
  readonly sideOpen = model(true);
  /** The side panel's share of the width, in percent. */
  readonly sideSize = model(20);

  /** Whether the page uses its narrow layout. */
  readonly narrow = injectNarrowViewport();

  protected readonly side = contentChild(AppShellSideDirective);
  protected readonly show = computed<SplitPaneShow>(() => {
    if (!this.side()) {
      return 'end';
    }
    if (this.narrow()) {
      return this.sideOpen() ? 'start' : 'end';
    }
    return this.sideOpen() ? 'both' : 'end';
  });

  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private drawerOpen = false;
  private returnFocus: HTMLElement | null = null;

  constructor() {
    afterRenderEffect(() => {
      const side = this.side();
      const open = Boolean(side) && this.narrow() && this.sideOpen();
      if (open === this.drawerOpen) {
        return;
      }
      this.drawerOpen = open;

      if (open) {
        this.returnFocus = document.activeElement as HTMLElement | null;
        side?.element.focus();
      } else {
        const target = this.returnFocus?.isConnected ? this.returnFocus : this.main().nativeElement;
        this.returnFocus = null;
        target.focus();
      }
    });
  }

  protected skipToMain(event: Event): void {
    // A fragment link would go through the router's base href.
    event.preventDefault();
    this.main().nativeElement.focus();
  }

  /** Closes the drawer, but only for an `Escape` from inside it. */
  protected onEscape(event: Event): void {
    if (this.drawerOpen && this.side()?.element.contains(event.target as Node)) {
      this.sideOpen.set(false);
    }
  }
}
