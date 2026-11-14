import { redo, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEditorState,
  type EditorStateOptions,
  isShowingConflicts,
  setConflicts,
  setReadOnly
} from '../state/editor-state';
import {
  acceptConflict,
  conflictAtCursor,
  type ConflictChoice,
  conflictsIn,
  type ConflictTexts,
  goToConflict
} from './conflict-extension';

const TEXTS: ConflictTexts = {
  ours: branch => `Mine (${branch})`,
  theirs: branch => `Theirs (${branch})`,
  acceptOurs: 'Accept mine',
  acceptTheirs: 'Accept theirs',
  acceptBoth: 'Accept both'
};

const FIRST = '<<<<<<< main\nmine 1\nmine 2\n=======\ntheirs 1\n>>>>>>> origin/main';
const SECOND = '<<<<<<< main\nmy end\n=======\ntheir end\n>>>>>>> origin/main';
const FILE = `# Title\n${FIRST}\nmiddle\n${SECOND}\nlast\n`;

const views: EditorView[] = [];

afterEach(() => {
  views.splice(0).forEach(view => view.destroy());
});

function open(content = FILE, options: Partial<EditorStateOptions> = {}): EditorView {
  const view = new EditorView({
    state: createEditorState({ content, highlight: false, label: 'a.md', conflicts: TEXTS, ...options })
  });
  document.body.append(view.dom);
  views.push(view);
  return view;
}

function textsOf(view: EditorView, selector: string): string[] {
  return Array.from(view.dom.querySelectorAll(selector)).map(element => element.textContent ?? '');
}

/** The text of each line with the class, without the labels that the widgets add. */
function linesWith(view: EditorView, className: string): string[] {
  return Array.from(view.dom.querySelectorAll(`.cm-line.${className}`)).map(line => {
    const copy = line.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.cm-conflict-label').forEach(label => label.remove());
    return copy.textContent ?? '';
  });
}

function click(view: EditorView, index: number, choice: ConflictChoice): void {
  const actions = view.dom.querySelectorAll('.cm-conflict-actions')[index];
  actions.querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`)?.click();
}

describe('conflictExtension', () => {
  it('shows mine and theirs with their own backgrounds and labels', () => {
    const view = open();

    expect(linesWith(view, 'cm-conflict-ours')).toEqual([ 'mine 1', 'mine 2', 'my end' ]);
    expect(linesWith(view, 'cm-conflict-theirs')).toEqual([ 'theirs 1', 'their end' ]);
    expect(linesWith(view, 'cm-conflict-marker')).toEqual([
      '<<<<<<< main',
      '=======',
      '>>>>>>> origin/main',
      '<<<<<<< main',
      '=======',
      '>>>>>>> origin/main'
    ]);
    expect(textsOf(view, '.cm-conflict-label')).toEqual([
      'Mine (main)',
      'Theirs (origin/main)',
      'Mine (main)',
      'Theirs (origin/main)'
    ]);
    expect(textsOf(view, '.cm-conflict-action')).toEqual([
      'Accept mine',
      'Accept theirs',
      'Accept both',
      'Accept mine',
      'Accept theirs',
      'Accept both'
    ]);
    expect(linesWith(view, 'cm-line').filter(line => line === 'middle')).toHaveLength(1);
    expect(view.dom.querySelector('.cm-line.cm-conflict-ours.cm-conflict-theirs')).toBeNull();
  });

  it('accepts mine', () => {
    const view = open();

    click(view, 0, 'ours');

    expect(view.state.doc.toString()).toBe(`# Title\nmine 1\nmine 2\nmiddle\n${SECOND}\nlast\n`);
    expect(conflictsIn(view.state)).toHaveLength(1);
  });

  it('accepts theirs', () => {
    const view = open();

    click(view, 1, 'theirs');

    expect(view.state.doc.toString()).toBe(`# Title\n${FIRST}\nmiddle\ntheir end\nlast\n`);
  });

  it('accepts both, mine first', () => {
    const view = open();

    click(view, 0, 'both');

    expect(view.state.doc.toString()).toBe(`# Title\nmine 1\nmine 2\ntheirs 1\nmiddle\n${SECOND}\nlast\n`);
  });

  it('removes the lines of a conflict whose chosen side is empty', () => {
    const atEnd = open('a\n<<<<<<< main\n=======\nb\n>>>>>>> origin/main');
    acceptConflict(atEnd, 0, 'ours');
    expect(atEnd.state.doc.toString()).toBe('a');

    const inside = open('a\n<<<<<<< main\n=======\nb\n>>>>>>> origin/main\nc');
    acceptConflict(inside, 0, 'ours');
    expect(inside.state.doc.toString()).toBe('a\nc');
  });

  it('keeps a last line without a line break so', () => {
    const view = open(`a\n${FIRST}`);

    acceptConflict(view, 0, 'theirs');

    expect(view.state.doc.toString()).toBe('a\ntheirs 1');
  });

  it('one undo brings the conflict back', () => {
    const view = open();
    view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' });

    acceptConflict(view, 0, 'both');
    undo(view);

    expect(view.state.doc.toString()).toBe(`x${FILE}`);
    expect(conflictsIn(view.state)).toHaveLength(2);
    redo(view);
    expect(conflictsIn(view.state)).toHaveLength(1);
  });

  it('the second conflict still works after the first is accepted', () => {
    const view = open();

    click(view, 0, 'theirs');
    click(view, 0, 'ours');

    expect(view.state.doc.toString()).toBe('# Title\ntheirs 1\nmiddle\nmy end\nlast\n');
    expect(conflictsIn(view.state)).toEqual([]);
    expect(view.dom.querySelector('.cm-conflict-actions')).toBeNull();
  });

  it('updates the regions as the user types', () => {
    const view = open();
    const at = FILE.indexOf('mine 1');

    view.dispatch({ changes: { from: at, insert: 'new ' }, userEvent: 'input.type' });

    const [ first, second ] = conflictsIn(view.state);
    expect(view.state.doc.sliceString(first.ours.from, first.ours.to)).toBe('new mine 1\nmine 2\n');
    expect(second.from).toBe(FILE.indexOf(SECOND) + 4);
    expect(linesWith(view, 'cm-conflict-ours')[0]).toBe('new mine 1');
  });

  it('parses only when the document changed', () => {
    const view = open();
    const regions = conflictsIn(view.state);

    view.dispatch({ selection: { anchor: 3 } });
    view.dispatch(setReadOnly(true));

    expect(conflictsIn(view.state)).toBe(regions);
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(conflictsIn(view.state)).not.toBe(regions);
  });

  it('removes a region when a marker is deleted', () => {
    const view = open();
    const middle = FILE.indexOf('=======');

    view.dispatch({ changes: { from: middle, to: middle + '=======\n'.length } });

    expect(conflictsIn(view.state)).toHaveLength(1);
    expect(textsOf(view, '.cm-conflict-label')).toEqual([ 'Mine (main)', 'Theirs (origin/main)' ]);
    expect(linesWith(view, 'cm-conflict-ours')).toEqual([ 'my end' ]);
  });

  it('says which conflict has the cursor', () => {
    const view = open();
    const second = FILE.indexOf(SECOND);

    expect(conflictAtCursor(view.state)).toBeNull();
    view.dispatch({ selection: { anchor: FILE.indexOf('theirs 1') } });
    expect(conflictAtCursor(view.state)).toBe(0);
    view.dispatch({ selection: { anchor: second } });
    expect(conflictAtCursor(view.state)).toBe(1);
    view.dispatch({ selection: { anchor: second + SECOND.length } });
    expect(conflictAtCursor(view.state)).toBe(1);
    view.dispatch({ selection: { anchor: FILE.indexOf('middle') } });
    expect(conflictAtCursor(view.state)).toBeNull();
  });

  it('moves the cursor to a conflict', () => {
    const view = open();

    goToConflict(view, 1);

    expect(view.state.selection.main.head).toBe(FILE.indexOf(SECOND));
    goToConflict(view, 5);
    expect(view.state.selection.main.head).toBe(FILE.indexOf(SECOND));
  });

  it('changes nothing without the option', () => {
    const view = open(FILE, { conflicts: undefined });

    expect(conflictsIn(view.state)).toEqual([]);
    expect(conflictAtCursor(view.state)).toBeNull();
    expect(view.dom.querySelector('.cm-conflict-marker, .cm-conflict-label, .cm-conflict-actions')).toBeNull();
    acceptConflict(view, 0, 'ours');
    expect(view.state.doc.toString()).toBe(FILE);
  });

  it('does not offer the widgets in a read-only editor', () => {
    const view = open(FILE, { readOnly: true });

    expect(view.dom.querySelector('.cm-conflict-actions')).toBeNull();
    expect(textsOf(view, '.cm-conflict-label')).toHaveLength(4);
    acceptConflict(view, 0, 'ours');
    expect(view.state.doc.toString()).toBe(FILE);

    view.dispatch(setReadOnly(false));
    expect(view.dom.querySelectorAll('.cm-conflict-actions')).toHaveLength(2);
  });

  it('keeps the buttons out of the tab order and the accessibility tree', () => {
    const view = open();

    const actions = view.dom.querySelector('.cm-conflict-actions');
    expect(actions?.getAttribute('aria-hidden')).toBe('true');
    expect(Array.from(actions?.querySelectorAll('button') ?? []).map(button => button.tabIndex)).toEqual([
      -1,
      -1,
      -1
    ]);
  });

  it('setConflicts turns it on and off, keeping the undo history and the cursor', () => {
    const view = open(FILE, { conflicts: undefined });
    view.dispatch({ changes: { from: 0, insert: 'x' }, selection: { anchor: 5 }, userEvent: 'input.type' });

    expect(isShowingConflicts(view.state)).toBe(false);
    view.dispatch(setConflicts(TEXTS));

    expect(isShowingConflicts(view.state)).toBe(true);
    expect(conflictsIn(view.state)).toHaveLength(2);
    expect(textsOf(view, '.cm-conflict-label')).toHaveLength(4);
    expect(view.state.selection.main.head).toBe(5);

    view.dispatch(setConflicts(null));

    expect(isShowingConflicts(view.state)).toBe(false);
    expect(conflictsIn(view.state)).toEqual([]);
    expect(view.dom.querySelector('.cm-conflict-label, .cm-conflict-actions')).toBeNull();
    expect(view.state.selection.main.head).toBe(5);
    undo(view);
    expect(view.state.doc.toString()).toBe(FILE);
  });

  it('has no conflicts when it is off', () => {
    const view = open();

    view.dispatch(setConflicts(null));

    expect(conflictsIn(view.state)).toEqual([]);
    expect(conflictAtCursor(view.state)).toBeNull();
  });
});
