import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Entry } from '@front-burner/shared-contracts';
import { EmptyStateComponent } from '@front-burner/ui';
import { TranslocoDirective } from '@jsverse/transloco';

import { fileName } from '../../utils/file-name/file-name';
import { EntryMessageComponent } from '../entry-message/entry-message.component';

/**
 * The editor area of the repository screen, inside its `main` region labelled
 * "Editor" (NV-17). Without a file it says how to start (FB-12). For a
 * Markdown file it shows the file's name until the editor exists; for any
 * other entry, or a path that does not exist, why it cannot be opened (FB-13,
 * FB-21).
 */
@Component({
  selector: 'rs-editor-area',
  imports: [ TranslocoDirective, EmptyStateComponent, EntryMessageComponent ],
  templateUrl: './editor-area.component.html',
  styleUrl: './editor-area.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditorAreaComponent {
  /** The open path, or `null` when no file is open. */
  readonly path = input<string | null>(null);
  /** The entry at `path`: `null` when there is none, `undefined` while it is being found. */
  readonly entry = input<Entry | null | undefined>(undefined);

  protected readonly name = computed(() => fileName(this.path() ?? ''));
  protected readonly markdown = computed(() => this.entry()?.kind === 'file' && this.entry()?.markdown === true);
}
