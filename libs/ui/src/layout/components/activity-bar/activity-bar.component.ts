import { Toolbar } from '@angular/aria/toolbar';
import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/**
 * VS Code's column of icons that switches the side panel (A-10.5), built on
 * Angular Aria's Toolbar: one tab stop, arrow keys between the items.
 *
 * Toolbar's own default orientation is horizontal, so the consumer binds
 * `orientation`: `vertical` beside the side panel, `horizontal` when it moves to
 * the bottom of a narrow screen (`AppShellComponent.narrow`, A-10.6).
 *
 * Clicking the selected item again unselects it, so that the side panel can
 * close.
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

  toggle(value: string): void {
    this.selected.update(selected => selected === value ? null : value);
  }
}
