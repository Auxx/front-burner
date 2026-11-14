import { isolateHistory } from '@codemirror/commands';
import { EditorState, type Extension, Facet, type Range, StateField, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { type ConflictRegion, regionsInLines } from './conflict-regions';

/**
 * The words that the conflict view shows, passed in by the caller since this library has no
 * translations. `ours` and `theirs` get the branch name from the marker, as in "Mine (main)".
 */
export interface ConflictTexts {
  ours: (branch: string) => string;
  theirs: (branch: string) => string;
  acceptOurs: string;
  acceptTheirs: string;
  acceptBoth: string;
}

export type ConflictChoice = 'ours' | 'theirs' | 'both';

const conflictTexts = Facet.define<ConflictTexts, ConflictTexts | null>({
  combine: values => values[0] ?? null
});

function regionsOf(doc: Text): readonly ConflictRegion[] {
  return regionsInLines(doc.iterLines());
}

// The regions, parsed again only when the document changed: one pass over its lines, and only
// in a conflicting file, the only one with this extension (NF-2.4).
const conflictField = StateField.define<readonly ConflictRegion[]>({
  create: state => regionsOf(state.doc),
  update: (regions, transaction) => (transaction.docChanged ? regionsOf(transaction.state.doc) : regions)
});

/** The label at the end of a marker line: "Mine (main)" or "Theirs (origin/main)". */
class LabelWidget extends WidgetType {
  constructor(private readonly text: string, private readonly side: 'ours' | 'theirs') {
    super();
  }

  override eq(other: LabelWidget): boolean {
    return other.text === this.text && other.side === this.side;
  }

  override toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = `cm-conflict-label cm-conflict-label-${this.side}`;
    element.textContent = this.text;
    return element;
  }
}

/**
 * **Accept mine**, **Accept theirs** and **Accept both** above a conflict (GC-11), for pointer
 * and touch. Buttons inside the editor's `contenteditable` can't be reached with `Tab`, which
 * the editor keeps for itself, so they are left out of the accessibility tree: the conflict
 * bar outside the editor offers the same to the keyboard and screen readers.
 */
class ActionsWidget extends WidgetType {
  constructor(private readonly index: number, private readonly texts: ConflictTexts) {
    super();
  }

  override eq(other: ActionsWidget): boolean {
    return other.index === this.index && other.texts === this.texts;
  }

  override get estimatedHeight(): number {
    return 28;
  }

  override toDOM(view: EditorView): HTMLElement {
    const element = document.createElement('div');
    element.className = 'cm-conflict-actions';
    element.setAttribute('aria-hidden', 'true');
    const choices: [ ConflictChoice, string ][] = [
      [ 'ours', this.texts.acceptOurs ],
      [ 'theirs', this.texts.acceptTheirs ],
      [ 'both', this.texts.acceptBoth ]
    ];
    for (const [ choice, text ] of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cm-conflict-action';
      button.tabIndex = -1;
      button.dataset['choice'] = choice;
      button.textContent = text;
      // The editor keeps the focus and its selection until the click.
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => acceptConflict(view, this.index, choice));
      element.append(button);
    }
    return element;
  }
}

const markerLine = Decoration.line({ class: 'cm-conflict-marker' });
const oursLine = Decoration.line({ class: 'cm-conflict-ours' });
const theirsLine = Decoration.line({ class: 'cm-conflict-theirs' });

function decorate(state: EditorState): DecorationSet {
  const texts = state.facet(conflictTexts);
  const regions = state.field(conflictField, false);
  if (!texts || !regions?.length) {
    return Decoration.none;
  }
  const doc = state.doc;
  const ranges: Range<Decoration>[] = [];
  const lines = (from: number, to: number, decoration: Decoration) => {
    for (let pos = from; pos < to;) {
      const line = doc.lineAt(pos);
      ranges.push(decoration.range(line.from));
      pos = line.to + 1;
    }
  };
  regions.forEach((region, index) => {
    if (!state.readOnly) {
      ranges.push(
        Decoration.widget({ widget: new ActionsWidget(index, texts), block: true, side: -1 }).range(region.from)
      );
    }
    const start = doc.lineAt(region.from);
    const middle = doc.lineAt(region.ours.to);
    const end = doc.lineAt(region.to);
    ranges.push(markerLine.range(start.from), markerLine.range(middle.from), markerLine.range(end.from));
    ranges.push(
      Decoration.widget({ widget: new LabelWidget(texts.ours(region.oursLabel), 'ours'), side: 1 }).range(start.to),
      Decoration.widget({ widget: new LabelWidget(texts.theirs(region.theirsLabel), 'theirs'), side: 1 }).range(end.to)
    );
    lines(region.ours.from, region.ours.to, oursLine);
    lines(region.theirs.from, region.theirs.to, theirsLine);
  });
  return Decoration.set(ranges, true);
}

// Block widgets can't come from a view plugin, so the decorations are computed from the
// state, again only when the regions, the texts or read-only change.
const conflictDecorations = EditorView.decorations.compute(
  [ conflictField, conflictTexts, EditorState.readOnly ],
  decorate
);

/**
 * Shows each conflict in the document with mine and theirs on their own backgrounds and
 * labelled on their marker lines (GC-10, NF-13.7), with the **Accept** buttons above it
 * unless the editor is read-only (GC-11). Independent of git: it reads only the text.
 */
export function conflictExtension(texts: ConflictTexts): Extension {
  return [ conflictTexts.of(texts), conflictField, conflictDecorations ];
}

/** The conflicts in the document, in order; none while the extension is off. */
export function conflictsIn(state: EditorState): readonly ConflictRegion[] {
  return state.field(conflictField, false) ?? [];
}

/** The index of the conflict that has the cursor, from its start marker to its end marker. */
export function conflictAtCursor(state: EditorState): number | null {
  const head = state.selection.main.head;
  const index = conflictsIn(state).findIndex(region => region.from <= head && head <= region.to);
  return index < 0 ? null : index;
}

/**
 * Replaces a conflict, markers included, with mine, theirs, or mine followed by theirs
 * (GC-11). One transaction, kept apart from the typing around it, so that one undo brings the
 * whole conflict back. A choice with no lines removes the conflict's lines entirely.
 */
export function acceptConflict(view: EditorView, index: number, choice: ConflictChoice): void {
  const region = conflictsIn(view.state)[index];
  if (!region || view.state.readOnly) {
    return;
  }
  const doc = view.state.doc;
  const ours = doc.sliceString(region.ours.from, region.ours.to);
  const theirs = doc.sliceString(region.theirs.from, region.theirs.to);
  const text = choice === 'ours' ? ours : choice === 'theirs' ? theirs : ours + theirs;
  // Each part's lines end with a line break; the one after the end marker stays.
  let change = { from: region.from, to: region.to, insert: text.slice(0, -1) };
  if (!text) {
    change = region.to < doc.length
      ? { from: region.from, to: region.to + 1, insert: '' }
      : { from: Math.max(0, region.from - 1), to: region.to, insert: '' };
  }
  view.dispatch({
    changes: change,
    selection: { anchor: change.from + change.insert.length },
    userEvent: 'input.accept',
    annotations: isolateHistory.of('full'),
    scrollIntoView: true
  });
}

/**
 * Moves the cursor to the start of a conflict, and scrolls to it (GC-10). The focus stays
 * where it is, so that the conflict bar's **Next** can be pressed again; the caller moves it
 * into the editor when it should.
 */
export function goToConflict(view: EditorView, index: number): void {
  const region = conflictsIn(view.state)[index];
  if (!region) {
    return;
  }
  view.dispatch({
    selection: { anchor: region.from },
    effects: EditorView.scrollIntoView(region.from, { y: 'center' })
  });
}
