import { undo } from '@codemirror/commands';
import { getSearchQuery, openSearchPanel, SearchQuery, searchPanelOpen } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { contentOf, createEditorState } from '../state/editor-state';
import { type FindPanelLabels } from './find-labels';
import { countMatches, MAX_COUNTED_MATCHES, openReplacePanel } from './find-panel';

const LABELS: FindPanelLabels = {
  find: 'L.find',
  replace: 'L.replace',
  toggleReplace: 'L.toggleReplace',
  matchCase: 'L.matchCase',
  wholeWord: 'L.wholeWord',
  regexp: 'L.regexp',
  previous: 'L.previous',
  next: 'L.next',
  close: 'L.close',
  replaceOne: 'L.replaceOne',
  replaceAll: 'L.replaceAll',
  noResults: 'L.noResults',
  invalid: 'L.invalid',
  count: (current, total, more) => `${current}/${total}${more ? '+' : ''}`
};

describe('the find panel', () => {
  let view: EditorView;

  afterEach(() => {
    view.destroy();
    view.dom.remove();
  });

  function open(content = 'foo bar foo baz foo', readOnly = false): EditorView {
    view = new EditorView({
      state: createEditorState({
        content,
        highlight: false,
        label: 'a.md',
        readOnly,
        findLabels: LABELS,
        findIconSprite: 'sprite.svg'
      })
    });
    document.body.append(view.dom);
    return view;
  }

  const panel = () => view.dom.querySelector('.cm-panel.fb-find') as HTMLElement;
  const named = (name: string) => panel().querySelector(`[aria-label="${name}"]`) as HTMLElement;
  const findField = () => named(LABELS.find) as HTMLInputElement;
  const replaceField = () => named(LABELS.replace) as HTMLInputElement;
  const toggle = () => named(LABELS.toggleReplace) as HTMLButtonElement;
  const replaceRow = () => replaceField().closest('.fb-find-row') as HTMLElement;
  const counter = () => panel().querySelector('.fb-find-count')?.textContent;
  const matches = () => view.dom.querySelectorAll('.cm-searchMatch').length;

  function type(field: HTMLInputElement, text: string): void {
    field.value = text;
    field.dispatchEvent(new Event('input'));
  }

  function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  }

  describe('its controls', () => {
    it('opens one compact panel with the find row in order, named from the labels', () => {
      openSearchPanel(open());

      expect(view.dom.querySelectorAll('.cm-panel').length).toBe(1);
      const names = Array.from(panel().querySelectorAll('button, input')).map(el => el.getAttribute('aria-label'));
      expect(names).toEqual([
        LABELS.toggleReplace,
        LABELS.find,
        LABELS.matchCase,
        LABELS.wholeWord,
        LABELS.regexp,
        LABELS.previous,
        LABELS.next,
        LABELS.close,
        LABELS.replace,
        LABELS.replaceOne,
        LABELS.replaceAll
      ]);
      const count = panel().querySelector('.fb-find-count') as HTMLElement;
      expect(count.getAttribute('aria-live')).toBe('polite');
      expect(named(LABELS.regexp).compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(count.compareDocumentPosition(named(LABELS.previous)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(panel().getAttribute('role')).toBe('search');
    });

    it('gives icon buttons a title and an icon from the sprite', () => {
      openSearchPanel(open());

      const next = named(LABELS.next);
      expect(next.title).toBe(LABELS.next);
      expect(next.querySelector('use')?.getAttribute('href')).toBe('sprite.svg#arrow-down');
      for (const [ label, icon ] of [ [ LABELS.matchCase, 'case-sensitive' ], [ LABELS.wholeWord, 'whole-word' ], [
        LABELS.regexp,
        'regex'
      ] ]) {
        expect(named(label).getAttribute('aria-pressed')).toBe('false');
        expect(named(label).querySelector('use')?.getAttribute('href')).toBe(`sprite.svg#${icon}`);
      }
    });

    it('hides the replace row until the chevron shows it', () => {
      openSearchPanel(open());

      expect(replaceRow().hidden).toBe(true);
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(toggle().getAttribute('aria-controls')).toBe(replaceRow().id);

      toggle().click();

      expect(replaceRow().hidden).toBe(false);
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(toggle().querySelector('use')?.getAttribute('href')).toBe('sprite.svg#chevron-down');
    });

    it('works in English without labels', () => {
      view = new EditorView({ state: createEditorState({ content: 'a', highlight: false, label: 'a.md' }) });
      document.body.append(view.dom);
      openSearchPanel(view);

      type(named('Find') as HTMLInputElement, 'a');
      expect(counter()).toBe('1 of 1');
    });
  });

  describe('finding', () => {
    it('searches as the user types, selects the first match and counts the matches', () => {
      openSearchPanel(open());

      expect(document.activeElement).toBe(findField());
      type(findField(), 'foo');

      expect(getSearchQuery(view.state).search).toBe('foo');
      expect(matches()).toBe(3);
      expect(view.state.selection.main).toMatchObject({ from: 0, to: 3 });
      expect(counter()).toBe('1/3');
    });

    it('goes to the next match with Enter and back with Shift-Enter', () => {
      openSearchPanel(open());
      type(findField(), 'foo');

      press(findField(), 'Enter');
      expect(counter()).toBe('2/3');
      expect(view.state.selection.main.from).toBe(8);

      press(findField(), 'Enter', { shiftKey: true });
      expect(counter()).toBe('1/3');

      named(LABELS.next).click();
      named(LABELS.next).click();
      expect(counter()).toBe('3/3');
      named(LABELS.previous).click();
      expect(counter()).toBe('2/3');
    });

    it('sets match case, whole word and regular expression from the toggles', () => {
      openSearchPanel(open('Foo foo foobar'));
      type(findField(), 'foo');
      expect(counter()).toBe('1/3');

      named(LABELS.matchCase).click();
      expect(getSearchQuery(view.state).caseSensitive).toBe(true);
      expect(named(LABELS.matchCase).getAttribute('aria-pressed')).toBe('true');
      expect(counter()).toBe('1/2');

      named(LABELS.wholeWord).click();
      expect(getSearchQuery(view.state).wholeWord).toBe(true);
      expect(counter()).toBe('1/1');

      named(LABELS.regexp).click();
      expect(getSearchQuery(view.state).regexp).toBe(true);
    });

    it('counts again when the text changes, without a current match off the selection', () => {
      openSearchPanel(open());
      type(findField(), 'foo');

      view.dispatch({ changes: { from: view.state.doc.length, insert: ' foo' }, selection: { anchor: 4 } });

      expect(counter()).toBe('0/4');
    });

    it('says when nothing matches, and nothing for an empty query', () => {
      openSearchPanel(open());
      type(findField(), 'nothing');
      expect(counter()).toBe(LABELS.noResults);

      type(findField(), '');
      expect(counter()).toBe('');
    });

    it('shows an invalid regular expression without highlighting or throwing', () => {
      openSearchPanel(open('a [b] c'));
      named(LABELS.regexp).click();

      expect(() => type(findField(), '[')).not.toThrow();

      expect(counter()).toBe(LABELS.invalid);
      expect(matches()).toBe(0);
      expect(() => named(LABELS.next).click()).not.toThrow();
    });

    it(`stops counting at ${MAX_COUNTED_MATCHES} matches in a 1 MB file`, () => {
      // A match every 500 characters, so that jsdom, which takes 10,000 characters as visible,
      // draws few highlights.
      const content = `a${' '.repeat(499)}`.repeat(2 * 1024);
      openSearchPanel(open(content));

      const start = performance.now();
      type(findField(), 'a');
      const keystroke = performance.now() - start;

      expect(counter()).toBe(`1/${MAX_COUNTED_MATCHES}+`);
      const counted = countMatches(view.state, new SearchQuery({ search: 'a' }));
      expect(counted.matches.length).toBe(MAX_COUNTED_MATCHES);
      expect(counted.more).toBe(true);
      // Generous, for slow CI machines; a browser frame is 16 ms.
      expect(keystroke).toBeLessThan(200);
    });

    it('focuses and selects the find field when opened again, without a second panel', () => {
      openSearchPanel(open());
      type(findField(), 'foo');
      view.focus();

      openSearchPanel(view);

      expect(view.dom.querySelectorAll('.fb-find').length).toBe(1);
      expect(document.activeElement).toBe(findField());
      expect([ findField().selectionStart, findField().selectionEnd ]).toEqual([ 0, 3 ]);
    });

    it('closes with Esc and with Close, giving the focus back to the editor', () => {
      openSearchPanel(open());

      press(findField(), 'Escape');

      expect(searchPanelOpen(view.state)).toBe(false);
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(view.contentDOM);

      openSearchPanel(view);
      named(LABELS.close).click();
      expect(searchPanelOpen(view.state)).toBe(false);
    });
  });

  describe('replacing', () => {
    it('replaces the current match with Replace and with Enter in the replace field', () => {
      openSearchPanel(open());
      toggle().click();
      type(findField(), 'foo');
      type(replaceField(), 'X');

      named(LABELS.replaceOne).click();
      expect(contentOf(view.state)).toBe('X bar foo baz foo');

      press(replaceField(), 'Enter');
      expect(contentOf(view.state)).toBe('X bar X baz foo');
    });

    it('replaces every match with Replace all', () => {
      openSearchPanel(open());
      toggle().click();
      type(findField(), 'foo');
      type(replaceField(), 'X');

      named(LABELS.replaceAll).click();

      expect(contentOf(view.state)).toBe('X bar X baz X');
      expect(counter()).toBe(LABELS.noResults);
    });

    it('deletes every match with an empty replacement, as one undoable change', () => {
      openSearchPanel(open());
      toggle().click();
      type(findField(), 'foo');

      named(LABELS.replaceAll).click();
      expect(contentOf(view.state)).toBe(' bar  baz ');

      undo(view);
      expect(contentOf(view.state)).toBe('foo bar foo baz foo');
    });

    it('opens expanded with the replace field focused from the replace command and Ctrl-H', () => {
      openReplacePanel(open());

      expect(replaceRow().hidden).toBe(false);
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement).toBe(replaceField());

      press(findField(), 'Escape');
      press(view.contentDOM, 'h', { ctrlKey: true, keyCode: 72 } as KeyboardEventInit);
      expect(searchPanelOpen(view.state)).toBe(true);
      expect(document.activeElement).toBe(replaceField());
    });

    it('hides the chevron and the replace row while read-only', () => {
      openReplacePanel(open('foo', true));

      expect(toggle().hidden).toBe(true);
      expect(replaceRow().hidden).toBe(true);
      expect(document.activeElement).toBe(findField());
    });
  });
});
