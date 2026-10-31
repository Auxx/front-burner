import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery
} from '@codemirror/search';
import { EditorSelection, type EditorState } from '@codemirror/state';
import { type Command, EditorView, type Panel, runScopeHandlers, type ViewUpdate } from '@codemirror/view';
import { findIconSprite, type FindPanelLabels, findLabels } from './find-labels';

/** The counter stops counting here, so that a short query in a 1 MB file stays responsive. */
export const MAX_COUNTED_MATCHES = 1000;

const SVG = 'http://www.w3.org/2000/svg';

/** A match of the query in the text. */
interface Match {
  from: number;
  to: number;
}

/** The first `MAX_COUNTED_MATCHES` matches of a valid query, and whether there are more. */
export function countMatches(state: EditorState, query: SearchQuery): { matches: Match[]; more: boolean; } {
  const matches: Match[] = [];
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    if (matches.length === MAX_COUNTED_MATCHES) {
      return { matches, more: true };
    }
    matches.push({ from: next.value.from, to: next.value.to });
  }
  return { matches, more: false };
}

/** The first match of a valid query at or after `from`, wrapping round to the start. */
function firstMatchFrom(state: EditorState, query: SearchQuery, from: number): Match | null {
  const after = query.getCursor(state, from).next();
  if (!after.done) {
    return after.value;
  }
  const before = query.getCursor(state, 0, from).next();
  return before.done ? null : before.value;
}

/** The panels on screen, so that `openReplacePanel` can reach the one it opened. */
const panels = new WeakMap<EditorView, FindPanel>();

let ids = 0;

/**
 * The compact find and replace panel (ED-11), as in VS Code and WebStorm: a
 * find row with a chevron that shows the replace row. CodeMirror panels are
 * DOM, so it is built with DOM methods and driven by `@codemirror/search`'s
 * query and commands. The editor's theme floats it over the top of the text.
 */
class FindPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;

  private readonly labels: FindPanelLabels;
  private readonly sprite: string;
  private readonly toggle: HTMLButtonElement;
  private readonly chevron: SVGUseElement;
  private readonly findField: HTMLInputElement;
  readonly replaceField: HTMLInputElement;
  private readonly caseButton: HTMLButtonElement;
  private readonly wordButton: HTMLButtonElement;
  private readonly regexpButton: HTMLButtonElement;
  private readonly counter: HTMLElement;
  private readonly replaceRow: HTMLElement;
  private query: SearchQuery;
  private expanded = false;
  private matches: Match[] = [];
  private more = false;

  constructor(private readonly view: EditorView) {
    this.labels = view.state.facet(findLabels);
    this.sprite = view.state.facet(findIconSprite);
    this.query = getSearchQuery(view.state);
    const labels = this.labels;
    const replaceRowId = `fb-find-replace-${++ids}`;

    this.toggle = this.iconButton('chevron-right', labels.toggleReplace, () => this.expand(!this.expanded));
    this.toggle.classList.add('fb-find-toggle');
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.setAttribute('aria-controls', replaceRowId);
    this.chevron = this.toggle.querySelector('use') as SVGUseElement;

    this.findField = this.field(labels.find, this.query.search);
    // `openSearchPanel` and CodeMirror's find commands look for this attribute.
    this.findField.setAttribute('main-field', 'true');
    this.replaceField = this.field(labels.replace, this.query.replace);

    this.caseButton = this.optionButton('case-sensitive', labels.matchCase, this.query.caseSensitive);
    this.wordButton = this.optionButton('whole-word', labels.wholeWord, this.query.wholeWord);
    this.regexpButton = this.optionButton('regex', labels.regexp, this.query.regexp);

    this.counter = document.createElement('span');
    this.counter.className = 'fb-find-count';
    this.counter.setAttribute('aria-live', 'polite');

    const findRow = this.row(
      this.findField,
      this.caseButton,
      this.wordButton,
      this.regexpButton,
      this.counter,
      this.iconButton('arrow-up', labels.previous, () => findPrevious(view)),
      this.iconButton('arrow-down', labels.next, () => findNext(view)),
      this.iconButton('close', labels.close, () => closeSearchPanel(view))
    );
    this.replaceRow = this.row(
      this.replaceField,
      this.iconButton('replace', labels.replaceOne, () => replaceNext(view)),
      this.iconButton('replace-all', labels.replaceAll, () => replaceAll(view))
    );
    this.replaceRow.id = replaceRowId;
    this.replaceRow.classList.add('fb-find-replace');

    const rows = document.createElement('div');
    rows.className = 'fb-find-rows';
    rows.append(findRow, this.replaceRow);

    this.dom = document.createElement('div');
    this.dom.className = 'fb-find';
    this.dom.setAttribute('role', 'search');
    this.dom.setAttribute('aria-label', labels.find);
    this.dom.append(this.toggle, rows);
    this.dom.addEventListener('keydown', event => this.keydown(event));

    this.showReplace();
    this.recount();
    panels.set(view, this);
  }

  mount(): void {
    this.findField.focus();
    this.findField.select();
  }

  update(update: ViewUpdate): void {
    let recount = update.docChanged;
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.setQuery(effect.value);
          recount = true;
        }
      }
    }
    if (update.state.readOnly !== update.startState.readOnly) {
      this.showReplace();
    }
    if (recount) {
      this.recount();
    } else if (update.selectionSet) {
      this.showCount();
    }
  }

  destroy(): void {
    panels.delete(this.view);
  }

  /** Shows or hides the replace row. */
  expand(on: boolean): void {
    this.expanded = on;
    this.showReplace();
  }

  private showReplace(): void {
    const readOnly = this.view.state.readOnly;
    const shown = this.expanded && !readOnly;
    if (!shown && this.replaceRow.contains(this.view.root.activeElement)) {
      this.findField.focus();
    }
    this.toggle.hidden = readOnly;
    this.toggle.setAttribute('aria-expanded', String(shown));
    this.chevron.setAttribute('href', `${this.sprite}#${shown ? 'chevron-down' : 'chevron-right'}`);
    this.replaceRow.hidden = !shown;
  }

  private keydown(event: KeyboardEvent): void {
    if (runScopeHandlers(this.view, event, 'search-panel')) {
      event.preventDefault();
    } else if (event.key === 'Enter' && event.target === this.findField) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(this.view);
    } else if (event.key === 'Enter' && event.target === this.replaceField) {
      event.preventDefault();
      replaceNext(this.view);
    }
  }

  /**
   * Sets the query from the fields and toggles. When what is searched for
   * changes, the first match from the selection on is selected, as in VS Code,
   * so that Next goes on from there.
   */
  private commit(): void {
    const query = new SearchQuery({
      search: this.findField.value,
      replace: this.replaceField.value,
      caseSensitive: pressed(this.caseButton),
      wholeWord: pressed(this.wordButton),
      regexp: pressed(this.regexpButton)
    });
    if (query.eq(this.query)) {
      return;
    }
    const searched = query.search !== this.query.search || query.caseSensitive !== this.query.caseSensitive ||
      query.wholeWord !== this.query.wholeWord || query.regexp !== this.query.regexp;
    this.query = query;
    const { state } = this.view;
    const match = searched && query.valid ? firstMatchFrom(state, query, state.selection.main.from) : null;
    this.view.dispatch({
      effects: [
        setSearchQuery.of(query),
        ...(match ? [ EditorView.scrollIntoView(match.from, { y: 'nearest' }) ] : [])
      ],
      ...(match ? { selection: EditorSelection.single(match.from, match.to), userEvent: 'select.search' } : {})
    });
    this.recount();
  }

  private setQuery(query: SearchQuery): void {
    this.query = query;
    this.findField.value = query.search;
    this.replaceField.value = query.replace;
    this.caseButton.setAttribute('aria-pressed', String(query.caseSensitive));
    this.wordButton.setAttribute('aria-pressed', String(query.wholeWord));
    this.regexpButton.setAttribute('aria-pressed', String(query.regexp));
  }

  private recount(): void {
    const counted = this.query.valid ? countMatches(this.view.state, this.query) : { matches: [], more: false };
    this.matches = counted.matches;
    this.more = counted.more;
    this.showCount();
  }

  private showCount(): void {
    const text = this.countText();
    // Only a new text, so that the live region is not announced again for nothing.
    if (this.counter.textContent !== text) {
      this.counter.textContent = text;
    }
  }

  private countText(): string {
    if (!this.query.search) {
      return '';
    }
    if (!this.query.valid) {
      return this.labels.invalid;
    }
    if (this.matches.length === 0) {
      return this.labels.noResults;
    }
    const { from, to } = this.view.state.selection.main;
    const current = this.matches.findIndex(match => match.from === from && match.to === to) + 1;
    return this.labels.count(current, this.matches.length, this.more);
  }

  private row(...children: HTMLElement[]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'fb-find-row';
    row.append(...children);
    return row;
  }

  private field(label: string, value: string): HTMLInputElement {
    const input = document.createElement('input');
    input.className = 'fb-find-field';
    input.type = 'text';
    input.value = value;
    input.placeholder = label;
    input.setAttribute('aria-label', label);
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.addEventListener('input', () => this.commit());
    return input;
  }

  private iconButton(icon: string, label: string, run: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fb-find-button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.append(this.icon(icon));
    button.addEventListener('click', run);
    return button;
  }

  private optionButton(icon: string, label: string, on: boolean): HTMLButtonElement {
    const button = this.iconButton(icon, label, () => {
      button.setAttribute('aria-pressed', String(!pressed(button)));
      this.commit();
    });
    button.setAttribute('aria-pressed', String(on));
    return button;
  }

  /** A Codicon from the sprite, as `ui-icon` draws it. */
  private icon(name: string): SVGSVGElement {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'fb-find-icon');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG, 'use');
    use.setAttribute('href', `${this.sprite}#${name}`);
    svg.append(use);
    return svg;
  }
}

function pressed(button: HTMLButtonElement): boolean {
  return button.getAttribute('aria-pressed') === 'true';
}

/** The find panel, for `search({ createPanel })`; its texts and icons come from `findLabels` and `findIconSprite`. */
export function createFindPanel(view: EditorView): Panel {
  return new FindPanel(view);
}

/** Opens the find panel with the replace row shown and the replace field focused; only the find row while read-only. */
export const openReplacePanel: Command = view => {
  openSearchPanel(view);
  const panel = panels.get(view);
  if (panel && !view.state.readOnly) {
    panel.expand(true);
    panel.replaceField.focus();
    panel.replaceField.select();
  }
  return true;
};
