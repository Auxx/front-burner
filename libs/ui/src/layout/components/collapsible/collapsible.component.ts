import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A region that slides open and closed in place, such as the details behind a
 * **How it works** or **Details** button. Its content stays in the document,
 * so that the button's `aria-controls` always names an element; while closed
 * it is `inert` and hidden, so it has no tab stops and screen readers skip it.
 * The slide uses the motion tokens and so is instant with reduced motion
 * (A-10.12). The button that opens it, with its `aria-expanded`, belongs to
 * the owner.
 */
@Component({
  selector: 'ui-collapsible',
  templateUrl: './collapsible.component.html',
  styleUrl: './collapsible.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.inert]': 'open() ? null : ""' }
})
export class CollapsibleComponent {
  readonly open = input(false, { transform: booleanAttribute });
}
