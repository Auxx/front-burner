import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { ButtonComponent, injectNarrowViewport, SplitPaneComponent } from '@front-burner/ui';
import {
  CodeEditorComponent,
  contentOf,
  createEditorState,
  cursorOf,
  type EditorStateChange,
  isHighlighting,
  replaceContent,
  setHighlighting,
  setLabel,
  setReadOnly
} from '@front-burner/web-code-editor';
import { MarkdownPreviewComponent, type PreviewPathLink } from '@front-burner/web-markdown';
import { TranslocoDirective } from '@jsverse/transloco';

import { DiskChangesService } from '../../services/disk-changes/disk-changes.service';
import { type OpenFile, OpenFilesService } from '../../services/open-files/open-files.service';
import { fileName } from '../../utils/file-name/file-name';
import { ChangedOnDiskComponent } from '../changed-on-disk/changed-on-disk.component';
import { DraftOfferComponent } from '../draft-offer/draft-offer.component';
import { GoneElsewhereComponent } from '../gone-elsewhere/gone-elsewhere.component';
import { LargeFileNoteComponent } from '../large-file-note/large-file-note.component';

type EditorState = EditorStateChange['state'];

/** The `revision` of the content each file's editor state was built from (ED-24). */
const built = new WeakMap<OpenFile, number>();

/**
 * The editor of the open file: CodeMirror with the file's own state (A-8.15),
 * **Find** (ED-11), and above it the offer of a browser draft (ED-7) and the
 * large-file note of ED-9a. While a draft is offered the editor is read-only;
 * **Restore** puts the draft in it as one undoable edit, which is saved at
 * once. Above it too, after a change on disk, the question **Reload** or
 * **Keep mine** (ED-24), or, for a file gone elsewhere, **Recreate it**
 * (ED-21); meanwhile the editor is read-only too, since nothing is saved
 * until the user chooses. When **Recreate it** finds the file there again,
 * the file is checked again, which asks **Reload** or **Keep mine**. Loaded with
 * `@defer`, so that CodeMirror stays out of the screen's first chunk (ED-4).
 *
 * Each new state of the editor is written back into the `OpenFile` at once,
 * and an edit goes to its saver, which reads the content only when it sends.
 * The editor is given another state only when another file is shown, or when
 * the file's highlighting, name, offered draft, gone state or loaded content
 * changes (ED-9a, ED-37), so that it is never handed a state older than its
 * own. A reloaded file gets a new state, without undo history, with the
 * cursor at the same line and column as far as the new text allows, and,
 * when it was the file shown, the same first visible line (ED-24).
 *
 * On wide screens the live preview is beside the editor (ED-26, A-8.12),
 * with `fragment` as the heading to scroll to; a link in it to another entry
 * is emitted as `openPath` (ED-31). On narrow screens only the editor is
 * shown. The preview follows the file's `preview` source, whose version is
 * bumped on every change of the text.
 */
@Component({
  selector: 'rs-editor-pane',
  imports: [
    TranslocoDirective,
    ButtonComponent,
    CodeEditorComponent,
    ChangedOnDiskComponent,
    DraftOfferComponent,
    GoneElsewhereComponent,
    LargeFileNoteComponent,
    MarkdownPreviewComponent,
    SplitPaneComponent
  ],
  templateUrl: './editor-pane.component.html',
  styleUrl: './editor-pane.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditorPaneComponent {
  readonly file = input.required<OpenFile>();
  /** The heading of the file to show in the preview, such as from a link in another file. */
  readonly fragment = input<string | null>(null);
  /** A link in the preview to another entry of the repository (ED-31). */
  readonly openPath = output<PreviewPathLink>();

  private readonly openFiles = inject(OpenFilesService);
  private readonly diskChanges = inject(DiskChangesService);
  private readonly editor = viewChild.required(CodeEditorComponent);
  /** The editor, once it is there: not while the pane first renders. */
  private readonly shownEditor = viewChild(CodeEditorComponent);
  private readonly injector = inject(Injector);
  /** The file whose state the editor was last given. */
  private shownFile: OpenFile | null = null;

  protected readonly narrow = injectNarrowViewport();
  /** The editor's share of the pane beside the preview, in percent. */
  protected readonly editorSize = signal(50);
  protected readonly name = computed(() => fileName(this.file().path()));

  protected readonly state = linkedSignal(() => {
    const file = this.file();
    return this.stateFor(
      file,
      file.highlight(),
      fileName(file.path()),
      file.draft() !== null || file.gone() || file.changed() !== null,
      file.revision()
    );
  });
  protected readonly noteShown = computed(() => {
    const file = this.file();
    return file.largeOnNarrow && !file.highlight();
  });

  protected openSearch(): void {
    this.editor().openSearch();
  }

  /** **Restore**: the draft replaces the text as one undoable edit and is saved at once (ED-7). */
  protected restore(): void {
    const file = this.file();
    this.openFiles.restoreDraft(file.path(), content => {
      const current = file.editorState as EditorState;
      file.editorState = current.update(replaceContent(current, content)).state;
      return () => contentOf(file.editorState as EditorState);
    });
    file.preview.version.update(version => version + 1);
    this.editor().focus();
  }

  /** **Discard**: the draft is deleted and the file stays as on disk (ED-7). */
  protected discard(): void {
    this.openFiles.discardDraft(this.file().path());
    this.editor().focus();
  }

  /** **Reload**: the new content replaces the unsaved edits (ED-24). */
  protected reload(): void {
    this.openFiles.reload(this.file().path(), { discard: true }).catch(() => undefined);
    this.editor().focus();
  }

  /** **Keep mine**: the editor's content is saved over the change on disk (ED-24). */
  protected keepMine(): void {
    const file = this.file();
    this.openFiles.keepMine(file.path(), () => contentOf(file.editorState as EditorState));
    this.editor().focus();
  }

  /** **Recreate it**: the file is created again with the editor's content (ED-21). */
  protected async recreate(): Promise<void> {
    const file = this.file();
    await this.openFiles.recreate(file.path(), () => contentOf(file.editorState as EditorState));
    if (file.recreateError()?.code === 'entry-exists') {
      this.diskChanges.notice(file.path());
    } else if (!file.gone() && this.file() === file) {
      this.editor().focus();
    }
  }

  protected changed(change: EditorStateChange): void {
    const file = this.file();
    file.editorState = change.state;
    this.state.set(change.state);
    if (change.docChanged) {
      file.saver.edit(() => contentOf(file.editorState as EditorState));
      file.preview.version.update(version => version + 1);
    }
  }

  /**
   * The file's state, created on its first showing and again for each
   * reload, with its highlighting, name and read-only mode brought up to date.
   */
  private stateFor(
    file: OpenFile,
    highlight: boolean,
    label: string,
    readOnly: boolean,
    revision: number
  ): EditorState {
    const existing = file.editorState as EditorState | null;
    const reloaded = existing !== null && (built.get(file) ?? 0) !== revision;
    built.set(file, revision);
    const view = this.shownEditor();
    if (reloaded && view && this.shownFile === file) {
      const top = view.topLine();
      afterNextRender(() => this.editor().scrollToLine(top), { injector: this.injector });
    }
    this.shownFile = file;
    const state = existing === null || reloaded
      ? createEditorState({
        content: file.file.content,
        highlight,
        label,
        readOnly,
        cursor: reloaded ? cursorOf(existing) : undefined
      })
      : existing.update(
        setLabel(label),
        ...(isHighlighting(existing) === highlight ? [] : [ setHighlighting(highlight) ]),
        ...(existing.readOnly === readOnly ? [] : [ setReadOnly(readOnly) ])
      ).state;
    file.editorState = state;
    file.preview.read = () => contentOf(file.editorState as EditorState);
    untracked(() => file.preview.version.update(version => version + 1));
    return state;
  }
}
