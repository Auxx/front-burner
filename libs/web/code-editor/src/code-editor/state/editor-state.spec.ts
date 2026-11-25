import { undo, undoDepth } from '@codemirror/commands';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState, type Transaction } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import {
  contentOf,
  createEditorState,
  cursorOf,
  type EditorStateOptions,
  isHighlighting,
  isSoftWrapping,
  replaceContent,
  setHighlighting,
  setLabel,
  setReadOnly,
  setSoftWrap
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

  it('reports the cursor by line and column', () => {
    const state = create({ content: 'one\ntwo\n' }).update({ selection: EditorSelection.cursor(6) }).state;

    expect(cursorOf(state)).toEqual({ line: 2, column: 3 });
  });

  it('starts the cursor at a line and column, as close as the text allows', () => {
    expect(cursorOf(create({ content: 'one\ntwo', cursor: { line: 2, column: 2 } }))).toEqual({ line: 2, column: 2 });
    expect(cursorOf(create({ content: 'one\nt', cursor: { line: 2, column: 9 } }))).toEqual({ line: 2, column: 2 });
    expect(cursorOf(create({ content: 'one', cursor: { line: 5, column: 2 } }))).toEqual({ line: 1, column: 2 });
    expect(cursorOf(create({ content: 'one' }))).toEqual({ line: 1, column: 1 });
  });

  it('wraps by default and can stop without losing the undo history', () => {
    let state = create({ content: 'a' });

    expect(isSoftWrapping(state)).toBe(true);
    state = state.update({ changes: { from: 1, insert: 'b' } }).state;
    state = state.update(setSoftWrap(false)).state;

    expect(isSoftWrapping(state)).toBe(false);
    expect(undoDepth(state)).toBe(1);
    expect(isSoftWrapping(state.update(setSoftWrap(true)).state)).toBe(true);
  });

  it('starts unwrapped when asked', () => {
    expect(isSoftWrapping(create({ softWrap: false }))).toBe(false);
  });

  it('shows line numbers', () => {
    const view = new EditorView({ state: create({ content: 'one\ntwo' }) });
    const numbers = view.dom.querySelector('.cm-lineNumbers')?.textContent ?? '';

    expect(numbers).toContain('1');
    expect(numbers).toContain('2');
    view.destroy();
  });
});

describe('the HTML language', () => {
  // A fresh module per test, so that each starts before the HTML language has loaded.
  let editor: typeof import('./editor-state');
  const HTML = '---\ntitle: Notes\n---\n\n# Heading\n\n<abbr title="x">y</abbr>\n';

  function createHtml(options: Partial<EditorStateOptions> = {}): EditorState {
    return editor.createEditorState({ content: HTML, highlight: true, label: 'notes.md', ...options });
  }

  /**
   * Whether the HTML tag's name and attribute are parsed as such, as the HTML language parses
   * them; it is mounted as an overlay on `HTMLTag`, which only `resolveInner` enters.
   */
  function hasHtmlTags(state: EditorState): boolean {
    const tree = ensureSyntaxTree(state, state.doc.length, 5000);
    const text = state.doc.toString();
    return tree?.resolveInner(text.indexOf('<abbr') + 2, 1).name === 'TagName'
      && tree.resolveInner(text.indexOf('title=') + 2, 1).name === 'AttributeName';
  }

  beforeEach(async () => {
    vi.resetModules();
    editor = await import('./editor-state');
  });

  afterEach(() => {
    vi.doUnmock('./markdown-html');
  });

  it('highlights Markdown and front matter before the HTML language has loaded', () => {
    const state = createHtml();

    expect(nodeNames(state)).toContain('Frontmatter');
    expect(nodeNames(state)).toContain('ATXHeading1');
    expect(nodeNames(state)).toContain('HTMLTag');
    expect(hasHtmlTags(state)).toBe(false);
  });

  it('highlights HTML tags once it has loaded and the state is upgraded', async () => {
    const state = createHtml();

    await editor.loadHtmlInMarkdown();
    const spec = editor.upgradeLanguage(state);
    if (spec === null) {
      throw new Error('Not upgraded');
    }
    const upgraded = state.update(spec).state;

    expect(hasHtmlTags(upgraded)).toBe(true);
    expect(nodeNames(upgraded)).toContain('Frontmatter');
    expect(hasHtmlTags(createHtml())).toBe(true);
  });

  it('keeps the text, the selection and the undo history when upgraded', async () => {
    const edited = createHtml().update({ changes: { from: 0, insert: 'x' }, selection: { anchor: 5, head: 7 } }).state;

    await editor.loadHtmlInMarkdown();
    const upgraded = edited.update(editor.upgradeLanguage(edited) ?? {}).state;

    expect(hasHtmlTags(upgraded)).toBe(true);
    expect(upgraded.doc.toString()).toBe(`x${HTML}`);
    expect(upgraded.selection.main).toMatchObject({ anchor: 5, head: 7 });
    expect(undoDepth(upgraded)).toBe(1);
    expect(runUndo(upgraded).doc.toString()).toBe(HTML);
  });

  it('upgrades nothing while highlighting is off, or before the load, or once upgraded', async () => {
    expect(editor.upgradeLanguage(createHtml())).toBeNull();

    await editor.loadHtmlInMarkdown();
    const off = createHtml({ highlight: false });
    const basic = editor.createEditorState({ content: HTML, highlight: false, label: 'notes.md' });

    expect(editor.upgradeLanguage(off)).toBeNull();
    expect(editor.upgradeLanguage(basic)).toBeNull();
    expect(editor.upgradeLanguage(createHtml())).toBeNull();
  });

  it('turns highlighting back on with the HTML language after the load', async () => {
    await editor.loadHtmlInMarkdown();
    const off = createHtml().update(editor.setHighlighting(false)).state;

    expect(editor.isHighlighting(off)).toBe(false);
    expect(editor.upgradeLanguage(off)).toBeNull();

    const on = off.update(editor.setHighlighting(true)).state;

    expect(editor.isHighlighting(on)).toBe(true);
    expect(hasHtmlTags(on)).toBe(true);
  });

  it('is highlighting with either language', async () => {
    const basic = createHtml();

    expect(editor.isHighlighting(basic)).toBe(true);
    await editor.loadHtmlInMarkdown();

    expect(editor.isHighlighting(basic)).toBe(true);
    expect(editor.isHighlighting(basic.update(editor.upgradeLanguage(basic) ?? {}).state)).toBe(true);
  });

  it('keeps the basic language when the load fails, and loads again on the next call', async () => {
    const log = vi.spyOn(console, 'error');
    vi.doMock('./markdown-html', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });

    await expect(editor.loadHtmlInMarkdown()).rejects.toThrow();
    const basic = createHtml();

    expect(editor.upgradeLanguage(basic)).toBeNull();
    expect(hasHtmlTags(basic)).toBe(false);

    vi.doUnmock('./markdown-html');
    await editor.loadHtmlInMarkdown();

    expect(editor.upgradeLanguage(basic)).not.toBeNull();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
