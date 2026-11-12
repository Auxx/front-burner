import { Toolbar } from '@angular/aria/toolbar';
import { afterRenderEffect, ChangeDetectionStrategy, Component, inject, input, model } from '@angular/core';

/**
 * VS Code's column of icons that switches the side panel (A-10.5), built on
 * Angular Aria's Toolbar: one tab stop, arrow keys between the items.
 *
 * Toolbar's own default orientation is horizontal, so the consumer binds
 * `orientation`: `vertical` beside the side panel, `horizontal` when it moves to
 * the bottom of a narrow screen (`AppShellComponent.narrow`, A-10.6).
 *
 * Clicking the selected item again unselects it, so that the side panel can
 * close. Items can come and go, such as while a page offers other tool windows:
 * when the one that is the tab stop goes, the first item left becomes it.
 */
@Component({
  selector: 'ui-activity-bar',
  templateUrl: './activity-bar.component.html',
  styleUrl: './activity-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [ { directive: Toolbar, inputs: [ 'orientation' ] } ],
  host: {
    '[attr.aria-label]': 'label()'
  }
})
export class ActivityBarComponent {
  readonly label = input.required<string>();
  /** The value of the selected item, or null when none is. */
  readonly selected = model<string | null>(null);

  constructor() {
    const toolbar = inject(Toolbar);
    // Once the toolbar has been used, it no longer picks a tab stop of its own: an
    // active item that went would leave every item out of the tab order.
    afterRenderEffect({
      write: () => {
        const pattern = toolbar._pattern;
        const items = pattern.inputs.items();
        const active = pattern.activeItem();
        if (active !== undefined && items.length > 0 && !items.includes(active)) {
          pattern.setDefaultState();
        }
      }
    });
  }

  toggle(value: string): void {
    this.selected.update(selected => selected === value ? null : value);
  }
}
