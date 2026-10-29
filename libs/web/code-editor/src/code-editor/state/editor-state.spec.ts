import { undo } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState, type Transaction } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import {
  contentOf,
  createEditorState,
  type EditorStateOptions,
  isHighlighting,
  replaceContent,
  setHighlighting,
  setLabel,
  setReadOnly
} from './editor-state';

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

/** Presses a key in a view of `content` with the selection from `anchor` to `head`. */
function press(content: string, key: string, anchor: number, head = anchor, options: { shiftKey?: boolean; } = {}) {
  const view = new EditorView({ state: create({ content }) });
  view.dispatch({ selection: { anchor, head } });
  runScopeHandlers(view, new KeyboardEvent('keydown', { key, ...options }), 'editor');
  const text = view.state.doc.toString();
  view.destroy();
  return text;
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
    const switched = edited.update(setHighlighting(true)).state;

    expect(isHighlighting(switched)).toBe(true);
    expect(nodeNames(switched)).toContain('ATXHeading1');
    expect(runUndo(switched).doc.toString()).toBe(FILE);
  });

  it('changes nothing on its own', () => {
    const view = new EditorView({ state: create({ content: '' }) });
    const type = (text: string) => {
      const { from, to } = view.state.selection.main;
      const insert = () =>
        view.state.update({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
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

  it('keeps a line of spaces on Enter', () => {
    expect(press('a\n    ', 'Enter', 6)).toBe('a\n    \n');
  });

  it('does not indent the new line on Enter', () => {
    const content = '---\nkey:\n  sub: 1\n---\n';

    expect(press(content, 'Enter', 16)).toBe('---\nkey:\n  sub: \n1\n---\n');
    expect(press('  - item', 'Enter', 8)).toBe('  - item\n');
    expect(press('  - item', 'Enter', 8, 8, { shiftKey: true })).toBe('  - item\n');
  });

  it('inserts a tab at the cursor', () => {
    expect(press('foo bar', 'Tab', 3)).toBe('foo\t bar');
  });

  it('replaces the selection with a tab', () => {
    expect(press('one\ntwo', 'Tab', 1, 5)).toBe('o\two');
  });

  it('moves the focus out on Esc then Tab', () => {
    const view = new EditorView({ state: create({ content: 'text' }) });
    const key = (keyCode: number) => {
      const event = new KeyboardEvent('keydown', { key: keyCode === 9 ? 'Tab' : 'Escape', keyCode, cancelable: true });
      view.contentDOM.dispatchEvent(event);
      return event;
    };

    key(27);
    const tab = key(9);

    expect(tab.defaultPrevented).toBe(false);
    expect(view.state.doc.toString()).toBe('text');
    view.destroy();
  });

  it('makes the state read-only', () => {
    const state = create({ readOnly: true });

    expect(state.readOnly).toBe(true);
    expect(state.facet(EditorView.editable)).toBe(false);

    const editable = state.update(setReadOnly(false)).state;

    expect(editable.readOnly).toBe(false);
    expect(editable.facet(EditorView.editable)).toBe(true);
  });

  it('inserts no tab when read-only', () => {
    const view = new EditorView({ state: create({ content: 'text', readOnly: true }) });

    runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Tab' }), 'editor');

    expect(view.state.doc.toString()).toBe('text');
    view.destroy();
  });

  it('renames the editor and keeps the undo history', () => {
    const edited = create().update({ changes: { from: 0, insert: 'x' } }).state;
    const renamed = edited.update(setLabel('ideas.md')).state;
    const view = new EditorView({ state: renamed });

    expect(view.contentDOM.getAttribute('aria-label')).toBe('ideas.md');
    expect(runUndo(renamed).doc.toString()).toBe(FILE);
    view.destroy();
  });

  it('replaces the whole text as one undoable edit', () => {
    const state = create();

    const replaced = state.update(replaceContent(state, '# Draft\n')).state;

    expect(contentOf(replaced)).toBe('# Draft\n');
    expect(runUndo(replaced).doc.toString()).toBe(FILE);
  });

  it('returns the text with LF', () => {
    const state = create({ content: 'one\r\ntwo\r\n' }).update({ selection: EditorSelection.cursor(0) }).state;

    expect(contentOf(state)).toBe('one\ntwo\n');
  });
});
