import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  input,
  linkedSignal,
  viewChild
} from '@angular/core';
import { ButtonComponent } from '@front-burner/ui';
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
import { TranslocoDirective } from '@jsverse/transloco';

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
 * **Keep mine** (ED-24), or, for a file gone elsewhere, **Recreate it**, while
 * the editor is read-only (ED-21). Loaded with
 * `@defer`, so that CodeMirror stays out of the screen's first chunk (ED-4).
 *
 * Each new state of the editor is written back into the `OpenFile` at once,
 * and an edit goes to its saver, which reads the content only when it sends.
 * The editor is given another state only when another file is shown, or when
 * the file's highlighting, name, offered draft, gone state or loaded content
 * changes (ED-9a, ED-37), so that it is never handed a state older than its
 * own. A reloaded file gets a new state, without undo history, with the
 * cursor at the same line and column and the same first visible line, as far
 * as the new text allows (ED-24).
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
    LargeFileNoteComponent
  ],
  templateUrl: './editor-pane.component.html',
  styleUrl: './editor-pane.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditorPaneComponent {
  readonly file = input.required<OpenFile>();

  private readonly openFiles = inject(OpenFilesService);
  private readonly editor = viewChild.required(CodeEditorComponent);
  private readonly injector = inject(Injector);

  protected readonly state = linkedSignal(() => {
    const file = this.file();
    return this.stateFor(
      file,
      file.highlight(),
      fileName(file.path()),
      file.draft() !== null || file.gone(),
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
    if (!file.gone() && this.file() === file) {
      this.editor().focus();
    }
  }

  protected changed(change: EditorStateChange): void {
    const file = this.file();
    file.editorState = change.state;
    this.state.set(change.state);
    if (change.docChanged) {
      file.saver.edit(() => contentOf(file.editorState as EditorState));
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
    if (reloaded) {
      const top = this.editor().topLine();
      afterNextRender(() => this.editor().scrollToLine(top), { injector: this.injector });
    }
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
    return state;
  }
}
