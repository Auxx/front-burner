import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  effect,
  ElementRef,
  input,
  model,
  untracked,
  viewChild
} from '@angular/core';

import { AppShellSideDirective } from '../../directives/app-shell-side/app-shell-side.directive';
import { injectNarrowViewport } from '../../utils/narrow-viewport/narrow-viewport.util';
import { SplitPaneComponent, SplitPaneShow } from '../split-pane/split-pane.component';

let nextId = 0;

/**
 * The layout of every page that needs a login (A-10.5, A-10.6): the header, an
 * optional activity bar and side panel, the main content and an optional status
 * bar, on the canvas.
 *
 * On wide screens the side panel is beside the content and can be resized and
 * collapsed (`sideOpen`). On narrow screens it is a drawer shown instead of the
 * content (`drawerOpen`): it takes the focus when it opens, `Escape` closes it,
 * and the focus goes back to where it was, unless the consumer has moved it.
 * The drawer starts closed and closes whenever the viewport crosses the
 * breakpoint, without moving the focus.
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
  /** Whether the side panel is beside the content on wide screens. */
  readonly sideOpen = model(true);
  /**
   * Whether the side panel is shown instead of the content on narrow screens.
   * It starts closed and closes whenever the viewport crosses the breakpoint.
   */
  readonly drawerOpen = model(false);
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
      return this.drawerOpen() ? 'start' : 'end';
    }
    return this.sideOpen() ? 'both' : 'end';
  });

  /** The skip link names `main` as its target, so that checkers such as axe count it as a skip link. */
  protected readonly mainId = `ui-app-shell-main-${nextId++}`;

  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private drawerShown = false;
  private wasNarrow = this.narrow();
  private returnFocus: HTMLElement | null = null;

  constructor() {
    // A rotated phone or a resized window starts with the drawer closed.
    let previous = this.narrow();
    effect(() => {
      const narrow = this.narrow();
      if (narrow !== previous) {
        previous = narrow;
        untracked(() => this.drawerOpen.set(false));
      }
    });

    afterRenderEffect(() => {
      const side = this.side();
      const narrow = this.narrow();
      const open = Boolean(side) && narrow && this.drawerOpen();
      const crossed = narrow !== this.wasNarrow;
      this.wasNarrow = narrow;
      if (open === this.drawerShown) {
        return;
      }
      this.drawerShown = open;

      if (open) {
        this.returnFocus = document.activeElement as HTMLElement | null;
        side?.element.focus();
        return;
      }

      // Crossing the breakpoint never moves the focus, and neither does a
      // consumer that has already put it somewhere else.
      const focused = document.activeElement;
      const lost = !focused || focused === document.body || Boolean(side?.element.contains(focused));
      if (!crossed && lost) {
        const opener = this.returnFocus;
        const target = opener?.isConnected && opener !== document.body ? opener : this.main().nativeElement;
        target.focus();
      }
      this.returnFocus = null;
    });
  }

  protected skipToMain(event: Event): void {
    // A fragment link would go through the router's base href.
    event.preventDefault();
    this.main().nativeElement.focus();
  }

  /**
   * Closes the drawer, but only for an `Escape` from inside it that no control
   * there has handled, such as a menu or an inline rename closing itself.
   */
  protected onEscape(event: Event): void {
    if (this.drawerShown && !event.defaultPrevented && this.side()?.element.contains(event.target as Node)) {
      this.drawerOpen.set(false);
    }
  }
}
