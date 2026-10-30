import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { ApiError, Entry } from '@front-burner/shared-contracts';
import { ButtonComponent, EmptyStateActionsComponent, EmptyStateComponent, SpinnerComponent } from '@front-burner/ui';
import { ApiErrorTextService } from '@front-burner/web-core';
import type { PreviewPathLink } from '@front-burner/web-markdown';
import { TranslocoDirective } from '@jsverse/transloco';

import type { OpenFile } from '../../services/open-files/open-files.service';
import type { EntryAction } from '../../utils/entry-actions/entry-actions';
import { fileName } from '../../utils/file-name/file-name';
import { EditorPaneComponent } from '../editor-pane/editor-pane.component';
import { EntryMessageComponent } from '../entry-message/entry-message.component';

/** The errors of opening a Markdown file that the message panel explains (FB-21). */
const EXPLAINED = new Set([ 'file-too-large', 'file-not-utf8' ]);

/**
 * The editor area of the repository screen, inside its `main` region labelled
 * "Editor" (NV-17). Without a file it says how to start, with a **New file**
 * button that emits `newFile` (FB-12). A Markdown file shows a loading state
 * while it opens (ED-5), then the editor pane, loaded on demand (ED-4); one
 * that cannot be opened, too large or not UTF-8, says why in the message
 * panel (FB-21), and any other failure offers **Try again** (`retryOpen`).
 * For any other entry, or a path that does not exist, it says why it cannot
 * be opened (FB-13, FB-21), with its actions emitted as `action`. A file
 * deleted or renamed elsewhere says so (`goneElsewhere`, FB-42). A link in
 * the preview to another entry is emitted as `openPath` (ED-31).
 */
@Component({
  selector: 'rs-editor-area',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    EmptyStateActionsComponent,
    EmptyStateComponent,
    SpinnerComponent,
    EditorPaneComponent,
    EntryMessageComponent
  ],
  templateUrl: './editor-area.component.html',
  styleUrl: './editor-area.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.editing]': 'editing()' }
})
export class EditorAreaComponent {
  private readonly errorText = inject(ApiErrorTextService);

  /** The open path, or `null` when no file is open. */
  readonly path = input<string | null>(null);
  /** The entry at `path`: `null` when there is none, `undefined` while it is being found. */
  readonly entry = input<Entry | null | undefined>(undefined);
  /** The Markdown file at `path`, once it has opened. */
  readonly file = input<OpenFile | null>(null);
  /** Why the Markdown file at `path` could not be opened. */
  readonly openError = input<ApiError | null>(null);
  /** Whether the file at `path` was deleted or renamed elsewhere since it was opened (FB-42). */
  readonly goneElsewhere = input(false);
  /** The heading of the open file to show in its preview (ED-31). */
  readonly fragment = input<string | null>(null);

  readonly newFile = output<void>();
  /** An action chosen for the entry at `path`, such as **Delete** (FB-21). */
  readonly action = output<EntryAction>();
  /** **Try again** after opening the Markdown file failed. */
  readonly retryOpen = output<void>();
  /** A link in the preview to another entry of the repository (ED-31). */
  readonly openPath = output<PreviewPathLink>();

  protected readonly name = computed(() => fileName(this.path() ?? ''));
  protected readonly markdown = computed(() => this.entry()?.kind === 'file' && this.entry()?.markdown === true);
  protected readonly explained = computed(() => {
    const code = this.openError()?.code;
    return code !== undefined && EXPLAINED.has(code) ? code : null;
  });
  protected readonly failure = computed(() => {
    const error = this.openError();
    return error ? this.errorText.describe(error) : null;
  });
  /** Whether the editor fills the area. */
  protected readonly editing = computed(() =>
    !this.goneElsewhere() && this.markdown() && this.openError() === null && this.file() !== null
  );
}
