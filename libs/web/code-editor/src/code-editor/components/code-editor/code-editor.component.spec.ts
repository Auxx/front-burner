import { CSP_NONCE } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { undo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { SWAPPING_ATTRIBUTE } from '../../search/find-panel';
import { createEditorState, loadHtmlInMarkdown, upgradeLanguage } from '../../state/editor-state';
import { CodeEditorComponent, type EditorStateChange } from './code-editor.component';

// The component's part in loading the full language is tested here with these two stubbed; the
// languages themselves in `editor-state.spec.ts`. By default they call through, with the full
// language loaded before every test, so that no upgrade lands in the middle of one.
vi.mock('../../state/editor-state', async importOriginal => {
  const actual = await importOriginal<typeof import('../../state/editor-state')>();
  return {
    ...actual,
    loadHtmlInMarkdown: vi.fn(actual.loadHtmlInMarkdown),
    upgradeLanguage: vi.fn(actual.upgradeLanguage)
  };
});

const NOTES = '# Notes\n\nSome text.\n';
const TODO = '# To do\n\n- Write tests\n';

describe('CodeEditorComponent', () => {
  let fixture: ComponentFixture<CodeEditorComponent>;
  let changes: EditorStateChange[];

  beforeAll(() => loadHtmlInMarkdown());

  function stateOf(content: string, label = 'notes.md'): EditorState {
    return createEditorState({ content, highlight: true, label });
  }

  async function show(state: EditorState): Promise<void> {
    fixture.componentRef.setInput('state', state);
    await fixture.whenStable();
  }

  function view(): EditorView {
    const editor = fixture.nativeElement.querySelector('.cm-editor') as HTMLElement;
    const found = EditorView.findFromDOM(editor);
    if (!found) {
      throw new Error('No editor view');
    }
    return found;
  }

  async function setUp(nonce?: string): Promise<void> {
    TestBed.configureTestingModule({
      imports: [ CodeEditorComponent ],
      providers: nonce ? [ { provide: CSP_NONCE, useValue: nonce } ] : []
    });
    fixture = TestBed.createComponent(CodeEditorComponent);
    changes = [];
    fixture.componentInstance.stateChange.subscribe(change => changes.push(change));
    await show(stateOf(NOTES));
  }

  afterEach(() => fixture.destroy());

  it('shows the given state', async () => {
    await setUp();

    expect(view().state.doc.toString()).toBe(NOTES);
    expect(fixture.nativeElement.querySelector('.cm-content').textContent).toContain('Some text.');
  });

  it('marks fb:editor-ready when the editor takes input', async () => {
    // jsdom has no User Timing API.
    const marks: { name: string; editable: string | null | undefined; text: string | undefined; }[] = [];
    performance.mark = ((name: string) => {
      const content = fixture.nativeElement.querySelector('.cm-content') as HTMLElement | null;
      marks.push({ name, editable: content?.getAttribute('contenteditable'), text: content?.textContent ?? undefined });
    }) as typeof performance.mark;
    try {
      await setUp();
      const todo = stateOf(TODO, 'todo.md');
      await show(todo);
      view().dispatch({ changes: { from: 0, insert: 'x' } });
      await show(changes[changes.length - 1].state);

      // Once per file shown, not per keystroke.
      expect(marks).toEqual([
        { name: 'fb:editor-ready', editable: 'true', text: expect.stringContaining('Some text.') },
        { name: 'fb:editor-ready', editable: 'true', text: expect.stringContaining('Write tests') }
      ]);
    } finally {
      delete (performance as Partial<Performance>).mark;
    }
  });

  it('lets each line take its direction from its text (ED-30)', async () => {
    await setUp();
    await show(stateOf('# Title\n\nمرحبا بكم\n'));

    const lines = Array.from(fixture.nativeElement.querySelectorAll('.cm-line') as NodeListOf<HTMLElement>);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.map(line => line.getAttribute('dir'))).toEqual(lines.map(() => 'auto'));

    view().dispatch({ changes: { from: view().state.doc.length, insert: '\nMore' } });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.cm-line:last-child')?.getAttribute('dir')).toBe('auto');
  });

  it('AC-EDIT-001.23: undoes the first file\'s edit after switching back', async () => {
    await setUp();
    const notes = stateOf(NOTES);
    await show(notes);
    view().dispatch({ changes: { from: NOTES.length, insert: 'More.\n' }, selection: { anchor: 3 } });
    const editedNotes = changes[changes.length - 1].state as EditorState;

    await show(stateOf(TODO, 'todo.md'));
    view().dispatch({ changes: { from: 0, insert: 'x' } });
    expect(view().state.doc.toString()).toBe(`x${TODO}`);

    await show(editedNotes);
    expect(view().state.selection.main.head).toBe(3);
    undo(view());

    expect(view().state.doc.toString()).toBe(NOTES);
  });

  it('switches files with the find panel open without sliding it out over the new file', async () => {
    await setUp();
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const style = real(element, pseudo);
      return (element as Element).classList?.contains('fb-find-closing')
        ? ({ ...style, animationDuration: '0.16s' } as CSSStyleDeclaration)
        : style;
    });
    openSearchPanel(view());
    expect(fixture.nativeElement.querySelector('.fb-find')).not.toBeNull();

    await show(stateOf(TODO, 'todo.md'));

    expect(fixture.nativeElement.querySelector('.fb-find')).toBeNull();
    expect(fixture.nativeElement.querySelector('.fb-find-closing')).toBeNull();
    expect(view().dom.hasAttribute(SWAPPING_ATTRIBUTE)).toBe(false);
    vi.restoreAllMocks();
  });

  it('shows a new state while focused', async () => {
    await setUp();
    view().focus();
    const todo = stateOf(TODO, 'todo.md').update({ selection: EditorSelection.cursor(5) }).state;

    await show(todo);

    expect(view().state).toBe(todo);
    expect(view().state.selection.main.head).toBe(5);
  });

  it('emits each transaction\'s state', async () => {
    await setUp();

    view().dispatch({ changes: { from: 0, insert: 'x' } });
    view().dispatch({ selection: { anchor: 1 } });

    expect(changes.map(change => change.docChanged)).toEqual([ true, false ]);
    expect(changes[changes.length - 1].state).toBe(view().state);
  });

  it('keeps the view when given the state it already has', async () => {
    await setUp();
    view().dispatch({ changes: { from: 0, insert: 'x' } });
    const current = view();

    await show(changes[0].state);

    expect(view()).toBe(current);
    expect(view().state).toBe(changes[0].state);
  });

  it('moves to a conflict and accepts one, as one undoable edit', async () => {
    await setUp();
    const conflict = '<<<<<<< main\nmine\n=======\ntheirs\n>>>>>>> origin/main';
    const content = `intro\n${conflict}\nend\n`;
    await show(
      createEditorState({
        content,
        highlight: false,
        label: 'guide.md',
        conflicts: {
          ours: branch => `Mine (${branch})`,
          theirs: branch => `Theirs (${branch})`,
          acceptOurs: 'Accept mine',
          acceptTheirs: 'Accept theirs',
          acceptBoth: 'Accept both'
        }
      })
    );

    fixture.componentInstance.goToConflict(0);
    expect(view().state.selection.main.head).toBe('intro\n'.length);

    fixture.componentInstance.acceptConflict(0, 'theirs');
    expect(view().state.doc.toString()).toBe('intro\ntheirs\nend\n');
    expect(changes.at(-1)?.docChanged).toBe(true);
    undo(view());
    expect(view().state.doc.toString()).toBe(content);
  });

  it('opens the search panel', async () => {
    await setUp();

    fixture.componentInstance.openSearch();

    expect(fixture.nativeElement.querySelector('.cm-panels-top .fb-find')).not.toBeNull();
  });

  it('ignores a line that is not a number', async () => {
    await setUp();

    expect(() => fixture.componentInstance.scrollToLine(Number.NaN)).not.toThrow();
    expect(changes).toEqual([]);
  });

  it('reports the place at the top after a scroll', async () => {
    await setUp();
    await show(stateOf(NOTES));
    const places: number[] = [];
    fixture.componentInstance.scrolled.subscribe(place => places.push(place));

    view().scrollDOM.dispatchEvent(new Event('scroll'));

    expect(places).toEqual([ 1 ]);
  });

  it('scrolls a fractional line that share of the line further', async () => {
    await setUp();
    await show(stateOf(NOTES));
    const dispatch = vi.spyOn(view(), 'dispatch');

    fixture.componentInstance.scrollToLine(3.5);

    const effect = dispatch.mock.calls[0][0] as {
      effects: { value: { range: { head: number; }; yMargin: number; }; };
    };
    expect(effect.effects.value.range.head).toBe(NOTES.indexOf('Some'));
    expect(effect.effects.value.yMargin).toBe(-0.5 * view().lineBlockAt(NOTES.indexOf('Some')).height);
  });

  it('passes the CSP nonce to CodeMirror', async () => {
    await setUp('test-nonce');

    expect(view().state.facet(EditorView.cspNonce)).toBe('');
    expect(document.head.querySelector('style[nonce="test-nonce"]')).not.toBeNull();
  });

  it('labels the editor with the file name', async () => {
    await setUp();

    expect(fixture.nativeElement.querySelector('.cm-content').getAttribute('aria-label')).toBe('notes.md');
  });

  it('uses classes, not inline colours, for tokens', async () => {
    await setUp();
    const content = fixture.nativeElement.querySelector('.cm-content') as HTMLElement;

    expect(content.querySelector('.tok-heading')).not.toBeNull();
    expect(content.querySelector('[style*="color"]')).toBeNull();
  });

  describe('the full language', () => {
    // What `upgradeLanguage` returns in these tests, which marks the dispatch it is given to.
    const UPGRADE: TransactionSpec = { selection: { anchor: 1 } };
    let events: string[];
    let finishLoad: (loaded: boolean) => void;

    /** Makes the next load wait for `finishLoad`, noting when it starts in `events`. */
    function holdNextLoad(): void {
      vi.mocked(loadHtmlInMarkdown).mockImplementationOnce(() => {
        events.push('load');
        return new Promise<void>((resolve, reject) => {
          finishLoad =
            loaded => (loaded ? resolve() : reject(new Error('Failed to fetch dynamically imported module')));
        });
      });
    }

    async function settle(): Promise<void> {
      await new Promise(resolve => setTimeout(resolve));
      await fixture.whenStable();
    }

    beforeEach(() => {
      events = [];
      // jsdom has no User Timing API.
      performance.mark = ((name: string) => {
        events.push(name);
      }) as typeof performance.mark;
    });

    afterEach(() => {
      delete (performance as Partial<Performance>).mark;
      vi.mocked(loadHtmlInMarkdown).mockReset();
      vi.mocked(upgradeLanguage).mockReset();
    });

    it('loads the HTML language after fb:editor-ready and upgrades the view', async () => {
      holdNextLoad();
      await setUp();

      expect(events).toEqual([ 'fb:editor-ready', 'load' ]);

      const shown = view().state;
      vi.mocked(upgradeLanguage).mockImplementation(state => (state === shown ? UPGRADE : null));
      const dispatch = vi.spyOn(view(), 'dispatch');
      finishLoad(true);
      await settle();

      expect(dispatch).toHaveBeenCalledExactlyOnceWith(UPGRADE);
      expect(changes.at(-1)?.state).toBe(view().state);
    });

    it('upgrades a state that was created before the load when it is shown', async () => {
      const before = stateOf(TODO, 'todo.md');
      await setUp();
      const dispatch = vi.spyOn(view(), 'dispatch');
      vi.mocked(upgradeLanguage).mockImplementation(state => (state === before ? UPGRADE : null));

      await show(before);

      expect(dispatch).toHaveBeenCalledExactlyOnceWith(UPGRADE);
      expect(changes.at(-1)?.state).toBe(view().state);
      expect(view().state.doc.toString()).toBe(TODO);
    });

    it('keeps the basic language without a word when the load fails, and tries again with the next file', async () => {
      const log = vi.spyOn(console, 'error');
      holdNextLoad();
      await setUp();
      vi.mocked(upgradeLanguage).mockReturnValue(UPGRADE);
      const dispatch = vi.spyOn(view(), 'dispatch');

      finishLoad(false);
      await settle();

      expect(dispatch).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();

      vi.mocked(upgradeLanguage).mockReturnValue(null);
      holdNextLoad();
      await show(stateOf(TODO, 'todo.md'));

      expect(events).toEqual([ 'fb:editor-ready', 'load', 'fb:editor-ready', 'load' ]);
      log.mockRestore();
    });

    it('loads the HTML language for a read-only state too, which marks no fb:editor-ready', async () => {
      holdNextLoad();
      TestBed.configureTestingModule({ imports: [ CodeEditorComponent ] });
      fixture = TestBed.createComponent(CodeEditorComponent);
      changes = [];
      fixture.componentInstance.stateChange.subscribe(change => changes.push(change));
      const readOnly = createEditorState({ content: NOTES, highlight: true, label: 'notes.md', readOnly: true });
      await show(readOnly);

      expect(events).toEqual([ 'load' ]);

      vi.mocked(upgradeLanguage).mockImplementation(state => (state === readOnly ? UPGRADE : null));
      const dispatch = vi.spyOn(view(), 'dispatch');
      finishLoad(true);
      await settle();

      expect(dispatch).toHaveBeenCalledExactlyOnceWith(UPGRADE);
    });

    it('upgrades at the next render, not as soon as the language has loaded', async () => {
      // A caller may build its next state only when change detection reads it, as the editor
      // pane does with the Wrap toggle: an upgrade emitted before would replace that state.
      holdNextLoad();
      await setUp();
      const shown = view().state;
      vi.mocked(upgradeLanguage).mockImplementation(state => (state === shown ? UPGRADE : null));
      const dispatch = vi.spyOn(view(), 'dispatch');

      finishLoad(true);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      expect(dispatch).not.toHaveBeenCalled();

      await fixture.whenStable();

      expect(dispatch).toHaveBeenCalledExactlyOnceWith(UPGRADE);
    });

    it('does not upgrade a state that the caller has replaced but the view does not show yet', async () => {
      holdNextLoad();
      await setUp();
      const replaced = view().state;
      const next = stateOf(TODO, 'todo.md');
      vi.mocked(upgradeLanguage).mockImplementation(state => (state === replaced ? UPGRADE : null));
      const dispatch = vi.spyOn(view(), 'dispatch');

      // The new state is given, but the view takes it only at the next change detection.
      fixture.componentRef.setInput('state', next);
      finishLoad(true);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }

      expect(dispatch).not.toHaveBeenCalled();
      expect(changes).toEqual([]);

      await fixture.whenStable();

      expect(view().state).toBe(next);
    });

    it('does not upgrade a view that is gone', async () => {
      holdNextLoad();
      await setUp();
      vi.mocked(upgradeLanguage).mockReturnValue(UPGRADE);
      const dispatch = vi.spyOn(view(), 'dispatch');

      fixture.destroy();
      finishLoad(true);
      await new Promise(resolve => setTimeout(resolve));

      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  it('removes the view when destroyed', async () => {
    await setUp();
    const host = fixture.nativeElement as HTMLElement;

    fixture.destroy();

    expect(host.querySelector('.cm-editor')).toBeNull();
  });
});
