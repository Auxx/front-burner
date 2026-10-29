import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, viewChild } from '@angular/core';
import { ButtonComponent } from '@front-burner/ui';
import {
  CodeEditorComponent,
  contentOf,
  createEditorState,
  type EditorStateChange,
  isHighlighting,
  setHighlighting,
  setLabel
} from '@front-burner/web-code-editor';
import { TranslocoDirective } from '@jsverse/transloco';

import type { OpenFile } from '../../services/open-files/open-files.service';
import { fileName } from '../../utils/file-name/file-name';
import { LargeFileNoteComponent } from '../large-file-note/large-file-note.component';

type EditorState = EditorStateChange['state'];

/**
 * The editor of the open file: CodeMirror with the file's own state (A-8.15),
 * **Find** (ED-11), and the large-file note of ED-9a above it. Loaded with
 * `@defer`, so that CodeMirror stays out of the screen's first chunk (ED-4).
 *
 * Each new state of the editor is written back into the `OpenFile` at once,
 * and an edit goes to its saver, which reads the content only when it sends.
 * The editor is given another state only when another file is shown, or when
 * the file's highlighting or name changes (ED-9a, ED-37), so that it is never
 * handed a state older than its own.
 */
@Component({
  selector: 'rs-editor-pane',
  imports: [ TranslocoDirective, ButtonComponent, CodeEditorComponent, LargeFileNoteComponent ],
  templateUrl: './editor-pane.component.html',
  styleUrl: './editor-pane.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditorPaneComponent {
  readonly file = input.required<OpenFile>();

  private readonly editor = viewChild.required(CodeEditorComponent);

  protected readonly state = linkedSignal(() => {
    const file = this.file();
    return this.stateFor(file, file.highlight(), fileName(file.path()));
  });
  protected readonly noteShown = computed(() => {
    const file = this.file();
    return file.largeOnNarrow && !file.highlight();
  });

  protected openSearch(): void {
    this.editor().openSearch();
  }

  protected changed(change: EditorStateChange): void {
    const file = this.file();
    file.editorState = change.state;
    this.state.set(change.state);
    if (change.docChanged) {
      file.saver.edit(() => contentOf(file.editorState as EditorState));
    }
  }

  /** The file's state, created on its first showing, with its highlighting and name brought up to date. */
  private stateFor(file: OpenFile, highlight: boolean, label: string): EditorState {
    const existing = file.editorState as EditorState | null;
    const state = existing === null
      ? createEditorState({ content: file.file.content, highlight, label })
      : existing.update(
        setLabel(label),
        ...(isHighlighting(existing) === highlight ? [] : [ setHighlighting(highlight) ])
      ).state;
    file.editorState = state;
    return state;
  }
}
