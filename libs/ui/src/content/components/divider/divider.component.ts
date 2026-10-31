import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * A horizontal separator between groups of content. With projected text, such
 * as "or", the text sits between two lines; without it, it is a single line.
 * Both lines are always rendered; CSS hides the text and the second line while
 * nothing is projected, so text that arrives late (a translation) causes no
 * layout shift.
 */
@Component({
  selector: 'ui-divider',
  templateUrl: './divider.component.html',
  styleUrl: './divider.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'separator' }
})
export class DividerComponent {}
