import { CSP_NONCE } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { undo } from '@codemirror/commands';
import { EditorSelection, type EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { createEditorState } from '../../state/editor-state';
import { CodeEditorComponent, type EditorStateChange } from './code-editor.component';

const NOTES = '# Notes\n\nSome text.\n';
const TODO = '# To do\n\n- Write tests\n';

describe('CodeEditorComponent', () => {
  let fixture: ComponentFixture<CodeEditorComponent>;
  let changes: EditorStateChange[];

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

  it('opens the search panel', async () => {
    await setUp();

    fixture.componentInstance.openSearch();

    expect(fixture.nativeElement.querySelector('.cm-panels-top .cm-search')).not.toBeNull();
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

  it('removes the view when destroyed', async () => {
    await setUp();
    const host = fixture.nativeElement as HTMLElement;

    fixture.destroy();

    expect(host.querySelector('.cm-editor')).toBeNull();
  });
});
