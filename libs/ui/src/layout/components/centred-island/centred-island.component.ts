import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IslandComponent } from '../island/island.component';

/**
 * A page made of one island centred on the canvas, both ways, with optional
 * content below it (banners, links). Used by pages that stand alone, such as
 * Login, Onboarding and Page not found.
 *
 * The host fills its container; a column taller than the container scrolls
 * from its top.
 */
@Component({
  selector: 'ui-centred-island',
  imports: [ IslandComponent ],
  templateUrl: './centred-island.component.html',
  styleUrl: './centred-island.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CentredIslandComponent {
  /** The island's maximum inline size. */
  readonly width = input('28rem');
}
