import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, viewChild } from '@angular/core';
import { ButtonComponent } from '@front-burner/ui';
import {
  CodeEditorComponent,
  contentOf,
  createEditorState,
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
import { DraftOfferComponent } from '../draft-offer/draft-offer.component';
import { LargeFileNoteComponent } from '../large-file-note/large-file-note.component';

type EditorState = EditorStateChange['state'];

/**
 * The editor of the open file: CodeMirror with the file's own state (A-8.15),
 * **Find** (ED-11), and above it the offer of a browser draft (ED-7) and the
 * large-file note of ED-9a. While a draft is offered the editor is read-only;
 * **Restore** puts the draft in it as one undoable edit, which is saved at
 * once. Loaded with
 * `@defer`, so that CodeMirror stays out of the screen's first chunk (ED-4).
 *
 * Each new state of the editor is written back into the `OpenFile` at once,
 * and an edit goes to its saver, which reads the content only when it sends.
 * The editor is given another state only when another file is shown, or when
 * the file's highlighting, name or offered draft changes (ED-9a, ED-37), so that it is never
 * handed a state older than its own.
 */
@Component({
  selector: 'rs-editor-pane',
  imports: [ TranslocoDirective, ButtonComponent, CodeEditorComponent, DraftOfferComponent, LargeFileNoteComponent ],
  templateUrl: './editor-pane.component.html',
  styleUrl: './editor-pane.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditorPaneComponent {
  readonly file = input.required<OpenFile>();

  private readonly openFiles = inject(OpenFilesService);
  private readonly editor = viewChild.required(CodeEditorComponent);

  protected readonly state = linkedSignal(() => {
    const file = this.file();
    return this.stateFor(file, file.highlight(), fileName(file.path()), file.draft() !== null);
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
    const draft = file.draft();
    if (draft === null) {
      return;
    }
    const current = file.editorState as EditorState;
    file.editorState = current.update(replaceContent(current, draft.content)).state;
    this.openFiles.restoreDraft(file.path(), () => contentOf(file.editorState as EditorState));
    this.editor().focus();
  }

  /** **Discard**: the draft is deleted and the file stays as on disk (ED-7). */
  protected discard(): void {
    this.openFiles.discardDraft(this.file().path());
    this.editor().focus();
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
   * The file's state, created on its first showing, with its highlighting,
   * name and read-only mode brought up to date.
   */
  private stateFor(file: OpenFile, highlight: boolean, label: string, readOnly: boolean): EditorState {
    const existing = file.editorState as EditorState | null;
    const state = existing === null
      ? createEditorState({ content: file.file.content, highlight, label, readOnly })
      : existing.update(
        setLabel(label),
        ...(isHighlighting(existing) === highlight ? [] : [ setHighlighting(highlight) ]),
        ...(existing.readOnly === readOnly ? [] : [ setReadOnly(readOnly) ])
      ).state;
    file.editorState = state;
    return state;
  }
}
