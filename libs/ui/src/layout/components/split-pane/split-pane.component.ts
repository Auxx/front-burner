import { Directionality } from '@angular/cdk/bidi';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, model, signal } from '@angular/core';

import { MenuItemComponent } from '../../../navigation/components/menu-item/menu-item.component';
import { MenuComponent } from '../../../navigation/components/menu/menu.component';
import { MenuTriggerDirective } from '../../../navigation/directives/menu-trigger/menu-trigger.directive';

/** Which panes of a split pane are on screen. */
export type SplitPaneShow = 'both' | 'start' | 'end';

/** One entry of a split pane's menu of sizes. */
export interface SplitPanePreset {
  readonly label: string;
  /** The start pane's share, in percent. */
  readonly size: number;
}

let nextId = 0;

/**
 * Two panes and a separator between them. The separator is resized by
 * dragging, or with the arrow keys, `Home` and `End` (A-10.33, NF-13.6).
 *
 * `size` is the start pane's share in percent. A size outside `[min, max]`,
 * such as a stale one restored from the browser, is shown clamped.
 *
 * Dragging is not possible for everyone (WCAG 2.5.7), so with `presets` and
 * `presetsLabel` a button on the separator opens a menu of sizes.
 */
@Component({
  selector: 'ui-split-pane',
  imports: [ MenuComponent, MenuItemComponent, MenuTriggerDirective ],
  templateUrl: './split-pane.component.html',
  styleUrl: './split-pane.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--ui-split-pane-size]': 'clampedSize() + "%"',
    '[attr.data-orientation]': 'orientation()'
  }
})
export class SplitPaneComponent {
  /** `horizontal` puts the panes side by side. */
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');
  /** The start pane's share, in percent. */
  readonly size = model(50);
  readonly min = input(10);
  readonly max = input(90);
  /** How far one arrow key press moves the separator, in percent. */
  readonly step = input(5);
  readonly show = input<SplitPaneShow>('both');
  /** The accessible name of the separator, such as "Resize file tree". */
  readonly separatorLabel = input.required<string>();

  /** Sizes offered in a menu on the separator, in percent. */
  readonly presets = input<readonly SplitPanePreset[]>([]);
  /** The accessible name of the menu button, such as "Pane sizes". */
  readonly presetsLabel = input<string>();

  protected readonly startId = `ui-split-pane-start-${nextId++}`;
  protected readonly clampedSize = computed(() => {
    const size = this.size();
    return this.clamp(Number.isFinite(size) ? size : 50);
  });
  protected readonly roundedSize = computed(() => Math.round(this.clampedSize()));

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly directionality = inject(Directionality);
  private readonly dragging = signal(false);

  protected choosePreset(size: number): void {
    this.size.set(this.clamp(size));
  }

  protected onKeydown(event: KeyboardEvent): void {
    const vertical = this.orientation() === 'vertical';
    const rtl = this.directionality.valueSignal() === 'rtl';
    const forward = vertical ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = vertical ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';

    const size = event.key === forward
      ? this.clampedSize() + this.step()
      : event.key === backward
      ? this.clampedSize() - this.step()
      : event.key === 'Home'
      ? this.min()
      : event.key === 'End'
      ? this.max()
      : undefined;
    if (size !== undefined) {
      event.preventDefault();
      this.size.set(this.clamp(size));
    }
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.dragging.set(true);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }
    // The grid's percentages resolve against the content box.
    const host = this.host.nativeElement;
    const rect = host.getBoundingClientRect();
    const style = getComputedStyle(host);
    const padding = (side: string) => parseFloat(style.getPropertyValue(`padding-${side}`)) || 0;
    const left = rect.left + padding('left');
    const right = rect.right - padding('right');
    const top = rect.top + padding('top');
    const bottom = rect.bottom - padding('bottom');

    const vertical = this.orientation() === 'vertical';
    const length = vertical ? bottom - top : right - left;
    if (length <= 0) {
      return;
    }
    const share = vertical
      ? (event.clientY - top) / length
      : this.directionality.valueSignal() === 'rtl'
      ? (right - event.clientX) / length
      : (event.clientX - left) / length;
    this.size.set(this.clamp(share * 100));
  }

  protected onPointerUp(event: PointerEvent): void {
    const separator = event.target as HTMLElement;
    if (separator.hasPointerCapture?.(event.pointerId)) {
      separator.releasePointerCapture(event.pointerId);
    }
    this.dragging.set(false);
  }

  private clamp(size: number): number {
    return Math.min(this.max(), Math.max(this.min(), size));
  }
}
