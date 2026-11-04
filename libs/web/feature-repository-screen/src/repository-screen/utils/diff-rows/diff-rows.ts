import type { DiffLine } from '@front-burner/shared-contracts';
import { diffWordsWithSpace } from 'diff';

/** A longer unchanged run is folded (GA-14). */
const FOLD_OVER_LINES = 8;
/** The unchanged lines a fold leaves on each side. */
const FOLD_CONTEXT_LINES = 3;
/** jsdiff is slow on long input: such a line, or a line of such a run, shows as a whole-line change. */
const MAX_WORD_DIFF_CHARS = 2000;
const MAX_WORD_DIFF_RUN = 500;

/** The mark of a trailing `\r`, so that a line ending change can be seen (GA-16). */
const CARRIAGE_RETURN_MARK = '␍';

/** A piece of a line's text; `changed` is a changed word, highlighted within the line. */
export interface DiffLinePart {
  text: string;
  changed: boolean;
}

/**
 * A row of the diff view: a line, or a fold. A fold holds the unchanged lines
 * it hides; it holds none where the response has a gap between its hunks.
 */
export type DiffRow =
  | { kind: 'line'; line: DiffLine; parts: DiffLinePart[]; }
  | { kind: 'fold'; hidden: DiffLine[]; };

const visibleText = (text: string) => text.endsWith('\r') ? `${text.slice(0, -1)}${CARRIAGE_RETURN_MARK}` : text;

/** A line whose text has no changed words, such as an unchanged line or one without a partner. */
export function wholeLineRow(line: DiffLine): DiffRow & { kind: 'line'; } {
  const text = visibleText(line.text);
  return { kind: 'line', line, parts: text === '' ? [] : [ { text, changed: false } ] };
}

/**
 * The rows of a diff (GA-14): unchanged runs over 8 lines are folded, and a
 * removed and an added line next to each other, paired up in order, have their
 * changed words marked. A pure function of the API's lines.
 */
export function diffRows(lines: DiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let nextOld = 1;
  let nextNew = 1;
  let index = 0;
  while (index < lines.length) {
    const first = lines[index];
    const type = first.type;
    if (
      (first.oldLine !== null && first.oldLine !== nextOld) || (first.newLine !== null && first.newLine !== nextNew)
    ) {
      rows.push({ kind: 'fold', hidden: [] });
    }
    let end = index + 1;
    while (end < lines.length && sameBlock(type, lines[end], lines[end - 1])) {
      end++;
    }
    const block = lines.slice(index, end);
    rows.push(...(type === 'context' ? contextRows(block) : changedRows(block)));
    for (const line of block) {
      nextOld = line.oldLine === null ? nextOld : line.oldLine + 1;
      nextNew = line.newLine === null ? nextNew : line.newLine + 1;
    }
    index = end;
  }
  return rows;
}

/** Whether `line` carries on the block of `type` that ended with `previous`, in the same hunk. */
function sameBlock(type: DiffLine['type'], line: DiffLine, previous: DiffLine): boolean {
  if (type === 'context') {
    return line.type === 'context' && line.oldLine === (previous.oldLine ?? 0) + 1
      && line.newLine === (previous.newLine ?? 0) + 1;
  }
  return line.type !== 'context' && (line.type === previous.type || line.type === 'added');
}

function contextRows(block: DiffLine[]): DiffRow[] {
  if (block.length <= FOLD_OVER_LINES) {
    return block.map(wholeLineRow);
  }
  return [
    ...block.slice(0, FOLD_CONTEXT_LINES).map(wholeLineRow),
    { kind: 'fold', hidden: block.slice(FOLD_CONTEXT_LINES, -FOLD_CONTEXT_LINES) },
    ...block.slice(-FOLD_CONTEXT_LINES).map(wholeLineRow)
  ];
}

/** The rows of removed lines and the added lines after them. */
function changedRows(block: DiffLine[]): DiffRow[] {
  const rows = block.map(wholeLineRow);
  if (block.length > MAX_WORD_DIFF_RUN) {
    return rows;
  }
  const added = block.findIndex(line => line.type === 'added');
  if (added <= 0) {
    return rows;
  }
  const pairs = Math.min(added, block.length - added);
  for (let pair = 0; pair < pairs; pair++) {
    const [ before, after ] = changedWords(block[pair].text, block[added + pair].text);
    rows[pair].parts = before;
    rows[added + pair].parts = after;
  }
  return rows;
}

/** The two lines' text in parts, with the words that differ marked; whole lines when a line is too long. */
function changedWords(before: string, after: string): [ DiffLinePart[], DiffLinePart[] ] {
  const oldText = visibleText(before);
  const newText = visibleText(after);
  if (oldText.length > MAX_WORD_DIFF_CHARS || newText.length > MAX_WORD_DIFF_CHARS) {
    return [ whole(oldText), whole(newText) ];
  }
  const changes = diffWordsWithSpace(oldText, newText);
  return [
    changes.filter(change => !change.added).map(change => ({ text: change.value, changed: change.removed })),
    changes.filter(change => !change.removed).map(change => ({ text: change.value, changed: change.added }))
  ];
}

const whole = (text: string): DiffLinePart[] => text === '' ? [] : [ { text, changed: false } ];
