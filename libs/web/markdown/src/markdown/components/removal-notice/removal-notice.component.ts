import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { BannerActionsComponent, ButtonComponent, InlineBannerComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import type { RemovalReport } from '../../pipeline/collect-removals';

/** One line of **Details**: what was removed, as shown, and how many times. */
interface RemovalItem {
  kind: 'tag' | 'attribute' | 'address';
  name: string;
  count: number;
}

let nextId = 0;

/**
 * The quiet line at the top of the preview when HTML was removed (SH-17 to
 * SH-20): "Some HTML isn't shown in the preview.", with **Details**, which
 * lists by count the tags, attributes and address kinds removed, never their
 * content or values (SH-18), and **Hide**, which sets `hidden`. It follows
 * the preview as the user types and is never announced (SH-20).
 */
@Component({
  selector: 'md-removal-notice',
  imports: [ TranslocoDirective, BannerActionsComponent, ButtonComponent, InlineBannerComponent ],
  templateUrl: './removal-notice.component.html',
  styleUrl: './removal-notice.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RemovalNoticeComponent {
  readonly removals = input.required<RemovalReport>();
  readonly hidden = model(false);

  protected readonly listId = `md-removal-notice-${nextId++}`;
  protected readonly expanded = signal(false);
  protected readonly items = computed(() =>
    [ ...this.removals() ]
      .filter(([ , count ]) => count > 0)
      .map(([ key, count ]): RemovalItem => {
        const colon = key.indexOf(':');
        const kind = key.slice(0, colon) as RemovalItem['kind'];
        const name = key.slice(colon + 1);
        return { kind, name: kind === 'tag' ? `<${name}>` : kind === 'address' ? `${name}:` : name, count };
      })
      .sort((a, b) => b.count - a.count)
  );
}
