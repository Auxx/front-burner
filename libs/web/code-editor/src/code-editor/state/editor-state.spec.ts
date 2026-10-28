import { undo } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState, type Transaction } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { contentOf, createEditorState, type EditorStateOptions, isHighlighting, setHighlighting, setReadOnly } from './editor-state';

const FILE = '---\ntitle: Notes\n---\n\n# Heading\n\nSome text.\n';

function create(options: Partial<EditorStateOptions> = {}): EditorState {
  return createEditorState({ content: FILE, highlight: true, label: 'notes.md', ...options });
}

function nodeNames(state: EditorState): Set<string> {
  const names = new Set<string>();
  ensureSyntaxTree(state, state.doc.length, 5000)?.iterate({ enter: node => void names.add(node.name) });
  return names;
}

function runUndo(state: EditorState): EditorState {
  let result = state;
  undo({ state, dispatch: (transaction: Transaction) => (result = transaction.state) });
  return result;
}

describe('createEditorState', () => {
  it('builds a state with the text', () => {
    expect(create().doc.toString()).toBe(FILE);
  });

  it('highlights Markdown and front matter', () => {
    const state = create();

    expect(isHighlighting(state)).toBe(true);
    expect(nodeNames(state)).toContain('Frontmatter');
    expect(nodeNames(state)).toContain('ATXHeading1');
  });

  it('starts without highlighting when asked', () => {
    const state = create({ highlight: false });

    expect(isHighlighting(state)).toBe(false);
    expect(nodeNames(state)).not.toContain('Frontmatter');
    expect(nodeNames(state)).not.toContain('ATXHeading1');
  });

  it('keeps the undo history when highlighting is switched', () => {
    const edited = create({ highlight: false }).update({ changes: { from: 0, insert: 'x' } }).state;
    const switched = edited.update(setHighlighting(edited, true)).state;

    expect(isHighlighting(switched)).toBe(true);
    expect(nodeNames(switched)).toContain('ATXHeading1');
    expect(runUndo(switched).doc.toString()).toBe(FILE);
  });

  it('changes nothing on its own', () => {
    const view = new EditorView({ state: create({ content: '' }) });
    const type = (text: string) => {
      const { from, to } = view.state.selection.main;
      const insert = () => view.state.update({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      if (!view.state.facet(EditorView.inputHandler).some(handler => handler(view, from, to, text, insert))) {
        view.dispatch(insert());
      }
    };

    type('(');
    type('\n- item');
    runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor');

    expect(view.state.doc.toString()).toBe('(\n- item\n');
    view.destroy();
  });

  it('makes the state read-only', () => {
    const state = create({ readOnly: true });

    expect(state.readOnly).toBe(true);
    expect(state.facet(EditorView.editable)).toBe(false);

    const editable = state.update(setReadOnly(state, false)).state;

    expect(editable.readOnly).toBe(false);
    expect(editable.facet(EditorView.editable)).toBe(true);
  });

  it('returns the text with LF', () => {
    const state = create({ content: 'one\r\ntwo\r\n' }).update({ selection: EditorSelection.cursor(0) }).state;

    expect(contentOf(state)).toBe('one\ntwo\n');
  });
});
