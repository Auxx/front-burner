import {
  afterNextRender,
  booleanAttribute,
  computed,
  DestroyRef,
  Directive,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal
} from '@angular/core';

import { attachTooltip } from '../../utils/tooltip/tooltip.util';

/**
 * Shows a host's full text in a tooltip while the host is too narrow for it
 * and shortens it with an ellipsis: `<button uiTruncatedTooltip="handbook">`
 * (NV-11). It shows on hover and keyboard focus, and with
 * `uiTruncatedTooltipLongPress` or `uiTruncatedTooltipShowOnClick` on a long
 * press or a tap, as `uiTooltip` does. The text is measured again when it
 * changes and as the host resizes. The tooltip never describes the host, since
 * its text is already the host's name; `truncated` says whether it is shown,
 * such as to make a host that is not a control focusable meanwhile.
 */
@Directive({
  selector: '[uiTruncatedTooltip]',
  exportAs: 'uiTruncatedTooltip'
})
export class TruncatedTooltipDirective {
  /** The host's full text. */
  readonly text = input.required<string>({ alias: 'uiTruncatedTooltip' });
  readonly showOnClick = input(false, { alias: 'uiTruncatedTooltipShowOnClick', transform: booleanAttribute });
  readonly longPress = input(false, { alias: 'uiTruncatedTooltipLongPress', transform: booleanAttribute });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly shortened = signal(false);

  /** Whether the host's text is shortened, so that the tooltip has something to show. */
  readonly truncated = this.shortened.asReadonly();

  constructor() {
    attachTooltip(this.host, computed(() => this.shortened() ? this.text() : ''), {
      describes: false,
      showOnClick: this.showOnClick,
      longPress: this.longPress
    });
    effect(() => {
      // Measured once the new text has rendered.
      this.text();
      afterNextRender(() => this.measure(), { injector: this.injector });
    });
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => this.measure());
      observer.observe(this.host);
      inject(DestroyRef).onDestroy(() => observer.disconnect());
    }
  }

  private measure(): void {
    this.shortened.set(this.host.scrollWidth > this.host.clientWidth);
  }
}
