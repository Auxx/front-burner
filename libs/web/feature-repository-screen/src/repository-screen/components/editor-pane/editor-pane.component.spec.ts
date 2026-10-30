import { BreakpointObserver } from '@angular/cdk/layout';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { undo, undoDepth } from '@codemirror/commands';
import {
  CodeEditorComponent,
  contentOf,
  cursorOf,
  type EditorStateChange,
  isHighlighting
} from '@front-burner/web-code-editor';
import { BehaviorSubject, map } from 'rxjs';

import { openFile } from '../../../testing/open-files';
import { settle } from '../../../testing/settle';
import { translocoTesting } from '../../../testing/transloco-testing';
import { DiskChangesService } from '../../services/disk-changes/disk-changes.service';
import { type OpenFile, OpenFilesService } from '../../services/open-files/open-files.service';
import { EditorPaneComponent } from './editor-pane.component';

const K = 'web-feature-repository-screen.EditorPaneComponent';

type EditorState = EditorStateChange['state'];

describe('EditorPaneComponent', () => {
  let fixture: ComponentFixture<EditorPaneComponent>;
  let notice: ReturnType<typeof vi.fn>;
  let narrow: BehaviorSubject<boolean>;
  let openFiles: {
    restoreDraft: ReturnType<typeof vi.fn>;
    discardDraft: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
    keepMine: ReturnType<typeof vi.fn>;
    recreate: ReturnType<typeof vi.fn>;
  };

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
      restoreDraft: vi.fn((_path: string, apply: (content: string) => () => string) => {
        const file = fixture.componentInstance.file();
        const draft = file.draft();
        if (draft) {
          file.draft.set(null);
          file.saver.edit(apply(draft.content));
        }
      }),
      discardDraft: vi.fn(() => fixture.componentInstance.file().draft.set(null)),
      reload: vi.fn(async () => true),
      keepMine: vi.fn(() => fixture.componentInstance.file().changed.set(null)),
      recreate: vi.fn(async () => fixture.componentInstance.file().gone.set(false))
    };
    notice = vi.fn();
    narrow = new BehaviorSubject(false);
    TestBed.configureTestingModule({
      imports: [ EditorPaneComponent, translocoTesting() ],
      providers: [
        {
          provide: BreakpointObserver,
          useValue: {
            isMatched: () => narrow.value,
            observe: () => narrow.pipe(map(matches => ({ matches, breakpoints: {} })))
          }
        },
        { provide: OpenFilesService, useValue: openFiles },
        { provide: DiskChangesService, useValue: { notice } }
      ]
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

  it('shows the preview beside the editor on wide screens and not on narrow ones', async () => {
    await show(openFile('docs/guide.md'));

    const preview = pane().querySelector('ui-split-pane [uiSplitPaneEnd]');
    expect(preview?.tagName).toBe('MD-PREVIEW');
    expect(preview?.querySelector('section')?.getAttribute('aria-label')).toBe(
      'web-markdown.MarkdownPreviewComponent.label'
    );
    expect(pane().querySelector('ui-split-pane [uiSplitPaneStart]')?.tagName).toBe('CE-CODE-EDITOR');

    narrow.next(true);
    await settle(fixture);

    expect(pane().querySelector('md-preview')).toBeNull();
    expect(pane().querySelector('ce-code-editor')).not.toBeNull();
  });

  it('gives the preview the editor\'s text and bumps its version on every edit', async () => {
    const file = openFile('README.md');
    await show(file);
    const version = file.preview.version();

    typeAtEnd('More.\n');

    expect(file.preview.version()).toBe(version + 1);
    expect(file.preview.read()).toBe('# README.md\nMore.\n');
  });

  it('emits a link of the preview to another entry', async () => {
    const opened: unknown[] = [];
    fixture.componentInstance.openPath.subscribe(link => opened.push(link));
    await show(openFile('docs/guide.md'));

    fixture.debugElement
      .query(element => element.name === 'md-preview')
      .componentInstance.openPath.emit({ path: 'docs/other.md', fragment: 'install' });

    expect(opened).toEqual([ { path: 'docs/other.md', fragment: 'install' } ]);
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

  describe('changes on disk (ED-21, ED-24)', () => {
    const MINE = 'one\ntwo\nthree\n';

    /** As `OpenFilesService.reload` does: the file is loaded again with `text`. */
    function reloadWith(file: OpenFile, text: string): void {
      file.file = { ...file.file, content: text };
      file.revision.update(revision => revision + 1);
    }

    function editorComponent(): CodeEditorComponent {
      return fixture.debugElement.query(element => element.name === 'ce-code-editor').componentInstance;
    }

    it('AC-EDIT-001.12: shows the new content when the file is reloaded', async () => {
      const file = openFile('README.md', { content: MINE });
      await show(file);

      reloadWith(file, 'theirs\n');
      await settle(fixture);

      expect(contentOf(stateOf(file))).toBe('theirs\n');
      expect(content().textContent).toContain('theirs');
      expect(stateOf(file).readOnly).toBe(false);
    });

    it('keeps the cursor and scroll line on reload', async () => {
      const file = openFile('README.md', { content: MINE });
      await show(file);
      const editor = editorComponent();
      vi.spyOn(editor, 'topLine').mockReturnValue(2);
      const scrolled = vi.spyOn(editor, 'scrollToLine');
      editor.stateChange.emit({
        state: stateOf(file).update({ selection: { anchor: 6 } }).state,
        docChanged: false
      });

      reloadWith(file, 'one\nt\nthree, changed\n');
      await settle(fixture);

      expect(cursorOf(stateOf(file))).toEqual({ line: 2, column: 2 });
      expect(scrolled).toHaveBeenCalledWith(2);
    });

    it('clears the undo history on reload', async () => {
      const file = openFile('README.md', { content: MINE });
      await show(file);
      typeAtEnd('more');
      expect(undoDepth(stateOf(file))).toBe(1);

      reloadWith(file, 'theirs\n');
      await settle(fixture);

      expect(undoDepth(stateOf(file))).toBe(0);
    });

    it('AC-EDIT-001.12: asks with unsaved edits, and Reload discards them', async () => {
      const file = openFile('README.md', { content: MINE });
      await show(file);
      file.changed.set('b'.repeat(64));
      await settle(fixture);

      expect(pane().querySelector('rs-changed-on-disk')?.textContent).toContain(
        'web-feature-repository-screen.ChangedOnDiskComponent.message'
      );
      // Nothing is saved until the user chooses, so nothing is typed meanwhile.
      expect(stateOf(file).readOnly).toBe(true);
      button('web-feature-repository-screen.ChangedOnDiskComponent.reload')?.click();

      expect(openFiles.reload).toHaveBeenCalledWith('README.md', { discard: true });
    });

    it('keeps mine with the editor\'s content', async () => {
      const file = openFile('README.md', { content: MINE });
      await show(file);
      typeAtEnd('mine');
      file.changed.set('b'.repeat(64));
      await settle(fixture);

      button('web-feature-repository-screen.ChangedOnDiskComponent.keepMine')?.click();
      await settle(fixture);

      const [ path, read ] = openFiles.keepMine.mock.calls[0] as [ string, () => string ];
      expect(path).toBe('README.md');
      expect(read()).toBe(`${MINE}mine`);
      expect(pane().querySelector('rs-changed-on-disk')).toBeNull();
    });

    it('AC-EDIT-001.11: keeps a file gone elsewhere read-only with Recreate it', async () => {
      const file = openFile('README.md', { content: MINE });
      await show(file);
      typeAtEnd('mine');
      file.gone.set(true);
      await settle(fixture);

      expect(stateOf(file).readOnly).toBe(true);
      expect(contentOf(stateOf(file))).toBe(`${MINE}mine`);
      expect(pane().querySelector('rs-gone-elsewhere')?.textContent).toContain(
        'web-feature-repository-screen.GoneElsewhereComponent.message'
      );

      button('web-feature-repository-screen.GoneElsewhereComponent.recreate')?.click();
      await settle(fixture);

      const [ path, read ] = openFiles.recreate.mock.calls[0] as [ string, () => string ];
      expect(path).toBe('README.md');
      expect(read()).toBe(`${MINE}mine`);
      expect(stateOf(file).readOnly).toBe(false);
      expect(undoDepth(stateOf(file))).toBe(1);
      expect(pane().querySelector('rs-gone-elsewhere')).toBeNull();
    });

    it('starts a file reloaded while another was shown at the top', async () => {
      const file = openFile('README.md', { content: MINE });
      const other = openFile('docs/guide.md');
      await show(file);
      await show(other);
      const scrolled = vi.spyOn(editorComponent(), 'scrollToLine');

      reloadWith(file, 'theirs\n');
      await show(file);

      expect(contentOf(stateOf(file))).toBe('theirs\n');
      expect(scrolled).not.toHaveBeenCalled();
    });

    it('builds a file reloaded while no pane was there', async () => {
      const file = openFile('README.md', { content: MINE });
      await show(file);
      fixture.destroy();
      reloadWith(file, 'theirs\n');
      fixture = TestBed.createComponent(EditorPaneComponent);

      await show(file);

      expect(content().textContent).toContain('theirs');
    });

    it('checks the file again when Recreate it finds it there again', async () => {
      const file = openFile('README.md', { content: MINE });
      openFiles.recreate.mockImplementation(async () =>
        file.recreateError.set({ code: 'entry-exists', params: {}, requestId: 'r1', message: 'entry-exists' })
      );
      await show(file);
      file.gone.set(true);
      await settle(fixture);

      button('web-feature-repository-screen.GoneElsewhereComponent.recreate')?.click();
      await settle(fixture);

      expect(notice).toHaveBeenCalledWith('README.md');
    });
  });
});
