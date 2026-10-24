import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

let nextId = 0;

/**
 * A panel on the canvas (A-10.5), with an optional header and a body that
 * scrolls. It reacts to its own width with container queries (A-10.7): its
 * content can use `@container ui-island (…)`.
 *
 * A body that scrolls is focusable, so that it can be scrolled with the
 * keyboard. Content that scrolls itself, such as the editor or a virtual tree,
 * sets `scrollable` to false and fills the body instead.
 *
 * It is a labelled region when it has a heading or a label, so that the panes
 * of the repository screen are landmarks (NV-17).
 */
@Component({
  selector: 'ui-island',
  templateUrl: './island.component.html',
  styleUrl: './island.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.role]': 'named() ? "region" : null',
    '[attr.aria-labelledby]': 'heading() ? titleId : null',
    '[attr.aria-label]': 'heading() ? null : label() ?? null'
  }
})
export class IslandComponent {
  /** The visible title in the header. */
  readonly heading = input<string>();
  /** The accessible name when there is no heading. */
  readonly label = input<string>();
  /** Whether the body scrolls; false when the content scrolls itself. */
  readonly scrollable = input(true, { transform: booleanAttribute });

  protected readonly titleId = `ui-island-title-${nextId++}`;
  protected readonly named = computed(() => Boolean(this.heading() || this.label()));
}
