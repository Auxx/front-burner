import { ComponentFixture, TestBed } from '@angular/core/testing';
import { undo, undoDepth } from '@codemirror/commands';
import { contentOf, type EditorStateChange, isHighlighting } from '@front-burner/web-code-editor';

import { openFile } from '../../../testing/open-files';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { type OpenFile, OpenFilesService } from '../../services/open-files/open-files.service';
import { EditorPaneComponent } from './editor-pane.component';

const K = 'web-feature-repository-screen.EditorPaneComponent';

type EditorState = EditorStateChange['state'];

describe('EditorPaneComponent', () => {
  let fixture: ComponentFixture<EditorPaneComponent>;
  let openFiles: { restoreDraft: ReturnType<typeof vi.fn>; discardDraft: ReturnType<typeof vi.fn>; };

  const pane = () => fixture.nativeElement as HTMLElement;
  const stateOf = (file: OpenFile) => file.editorState as EditorState;
  const content = () => pane().querySelector('.cm-content') as HTMLElement;
  const button = (text: string) =>
    [ ...pane().querySelectorAll('button') ].find(element => element.textContent?.trim() === text);

  async function show(file: OpenFile): Promise<void> {
    fixture.componentRef.setInput('file', file);
    await settle(fixture);
  }

  /** Types `text` at the end of the document, as a keystroke would. */
  function typeAtEnd(text: string): void {
    const editor = fixture.debugElement.query(element => element.name === 'ce-code-editor');
    const state = stateOf(fixture.componentInstance.file());
    editor.componentInstance.stateChange.emit({
      state: state.update({ changes: { from: state.doc.length, insert: text } }).state,
      docChanged: true
    });
  }

  beforeEach(() => {
    // As OpenFilesService does: the offer ends, and a restored draft is saved.
    openFiles = {
      restoreDraft: vi.fn((_path: string, read: () => string) => {
        const file = fixture.componentInstance.file();
        file.draft.set(null);
        file.saver.edit(read);
      }),
      discardDraft: vi.fn(() => fixture.componentInstance.file().draft.set(null))
    };
    TestBed.configureTestingModule({
      imports: [ EditorPaneComponent, translocoTesting() ],
      providers: [ { provide: OpenFilesService, useValue: openFiles } ]
    });
    fixture = TestBed.createComponent(EditorPaneComponent);
  });

  afterEach(() => fixture.destroy());

  it('AC-EDIT-001.1: opens a Markdown file in the editor, highlighted', async () => {
    const file = openFile('docs/guide.md', { content: '---\ntitle: Guide\n---\n# Guide\n' });

    await show(file);

    expect(content().textContent).toContain('# Guide');
    expect(isHighlighting(stateOf(file))).toBe(true);
    expect(pane().querySelector('rs-large-file-note')).toBeNull();
  });

  it('labels the editor with the file name', async () => {
    const file = openFile('docs/guide.md');
    await show(file);
    expect(content().getAttribute('aria-label')).toBe('guide.md');

    file.path.set('docs/handbook.md');
    await settle(fixture);

    expect(content().getAttribute('aria-label')).toBe('handbook.md');
  });

  it('writes each new state back into the open file and records edits', async () => {
    const file = openFile('README.md');
    await show(file);

    typeAtEnd('More.\n');

    expect(contentOf(stateOf(file))).toBe('# README.md\nMore.\n');
    expect(file.saver.unsaved()).toBe(true);
  });

  it('keeps a file\'s editor state when another file is opened and back', async () => {
    const readme = openFile('README.md');
    await show(readme);
    typeAtEnd('More.\n');
    const edited = stateOf(readme);

    await show(openFile('docs/guide.md'));
    expect(content().textContent).toContain('# docs/guide.md');
    await show(readme);

    expect(content().textContent).toContain('More.');
    expect(contentOf(stateOf(readme))).toBe(contentOf(edited));
  });

  it('opens find and replace from Find', async () => {
    await show(openFile('README.md'));

    button(`${K}.find`)?.click();
    await settle(fixture);

    expect(pane().querySelector('.cm-search')).not.toBeNull();
  });

  describe('AC-EDIT-001.25: a large file on a narrow screen', () => {
    function large(): OpenFile {
      const file = openFile('big.md', { size: 150_000 });
      file.largeOnNarrow = true;
      file.highlight.set(false);
      return file;
    }

    it('opens without highlighting, with the note', async () => {
      const file = large();

      await show(file);

      expect(isHighlighting(stateOf(file))).toBe(false);
      expect(pane().querySelector('rs-large-file-note')).not.toBeNull();
    });

    it('turns highlighting on and hides the note', async () => {
      const file = large();
      await show(file);
      typeAtEnd('Edited.\n');

      button('web-feature-repository-screen.LargeFileNoteComponent.turnOn')?.click();
      await settle(fixture);

      expect(isHighlighting(stateOf(file))).toBe(true);
      expect(contentOf(stateOf(file))).toContain('Edited.');
      expect(pane().querySelector('rs-large-file-note')).toBeNull();
    });

    it('shows the note again when opened again, with the undo history kept', async () => {
      const file = large();
      await show(file);
      typeAtEnd('Edited.\n');
      button('web-feature-repository-screen.LargeFileNoteComponent.turnOn')?.click();
      await settle(fixture);
      await show(openFile('README.md'));

      // Opening it again, as OpenFilesService does.
      file.highlight.set(false);
      await show(file);

      expect(pane().querySelector('rs-large-file-note')).not.toBeNull();
      expect(isHighlighting(stateOf(file))).toBe(false);
      expect(contentOf(stateOf(file))).toContain('Edited.');
      // The edit is still in the history.
      expect(undoDepth(stateOf(file))).toBeGreaterThan(0);
    });
  });

  describe('a browser draft (ED-7)', () => {
    const DISK = '# README.md\n';
    const DRAFT = { content: '# README.md\nOffline edit.\n', savedAt: '2026-10-29T10:05:00.000Z' };

    function withDraft(): OpenFile {
      const file = openFile('README.md');
      file.draft.set(DRAFT);
      return file;
    }

    it('offers a draft and keeps the editor read-only', async () => {
      const file = withDraft();

      await show(file);

      expect(pane().querySelector('rs-draft-offer')).not.toBeNull();
      expect(contentOf(stateOf(file))).toBe(DISK);
      expect(stateOf(file).readOnly).toBe(true);
      expect(content().getAttribute('contenteditable')).toBe('false');
    });

    it('restores a draft as one undoable edit and saves it', async () => {
      const file = withDraft();
      await show(file);

      button('web-feature-repository-screen.DraftOfferComponent.restore')?.click();
      await settle(fixture);

      expect(contentOf(stateOf(file))).toBe(DRAFT.content);
      expect(content().textContent).toContain('Offline edit.');
      expect(stateOf(file).readOnly).toBe(false);
      expect(pane().querySelector('rs-draft-offer')).toBeNull();
      expect(openFiles.restoreDraft).toHaveBeenCalledWith('README.md', expect.any(Function));
      expect(file.saver.unsaved()).toBe(true);
      expect(file.saver.waiting()).toBe(DRAFT.content);
      let undone = stateOf(file);
      undo({ state: undone, dispatch: transaction => (undone = transaction.state) });
      expect(contentOf(undone)).toBe(DISK);
    });

    it('discards a draft and keeps the file as on disk', async () => {
      const file = withDraft();
      await show(file);

      button('web-feature-repository-screen.DraftOfferComponent.discard')?.click();
      await settle(fixture);

      expect(openFiles.discardDraft).toHaveBeenCalledWith('README.md');
      expect(contentOf(stateOf(file))).toBe(DISK);
      expect(stateOf(file).readOnly).toBe(false);
      expect(pane().querySelector('rs-draft-offer')).toBeNull();
    });
  });
});
