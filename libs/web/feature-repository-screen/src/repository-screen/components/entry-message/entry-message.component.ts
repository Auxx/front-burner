import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Entry } from '@front-burner/shared-contracts';
import { EmptyStateComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { fileName } from '../../utils/file-name/file-name';

/**
 * What the editor area shows for an entry that cannot be opened: its name and
 * why (FB-21), or that the route's path does not exist (FB-13). The two
 * reasons found only when a file is opened (too large, not UTF-8) come with
 * reading files.
 */
@Component({
  selector: 'rs-entry-message',
  imports: [ TranslocoDirective, EmptyStateComponent ],
  templateUrl: './entry-message.component.html',
  styleUrl: './entry-message.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryMessageComponent {
  /** The entry at `path`, or `null` when there is none. */
  readonly entry = input.required<Entry | null>();
  readonly path = input.required<string>();

  protected readonly name = computed(() => fileName(this.path()));
  protected readonly reason = computed(() => {
    switch (this.entry()?.kind) {
      case undefined:
        return 'missing';
      case 'symlink':
        return 'symlink';
      case 'submodule':
        return 'submodule';
      default:
        // A folder named by the route cannot be opened either.
        return 'nonMarkdown';
    }
  });
}
