import type { DiffLine, GitDiff } from '@front-burner/shared-contracts';
import { diffWordsWithSpace } from 'diff';

/** A longer unchanged run is folded (GA-14). */
const FOLD_OVER_LINES = 8;
/** The unchanged lines a fold leaves on each side. */
const FOLD_CONTEXT_LINES = 3;
/** jsdiff is slow on long input: such a line, or a line of such a run, shows as a whole-line change. */
const MAX_WORD_DIFF_CHARS = 2000;
const MAX_WORD_DIFF_RUN = 500;
/**
 * The characters of one diff that go through jsdiff, top to bottom, so that many
 * long lines cannot add up to a frozen tab: a pair of 2,000-character lines with
 * no word in common takes about 30 ms, so at worst this is about 300 ms.
 */
const MAX_WORD_DIFF_TOTAL_CHARS = 40_000;
/** Git's default: a last hunk with fewer unchanged lines after its last change reaches the end of the file. */
const GIT_CONTEXT_LINES = 3;

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

/** The old lines a fold hides, both included. Old lines stay where they are while the working tree changes. */
export interface FoldRange {
  from: number;
  to: number;
}

export const foldsOverlap = (a: FoldRange, b: FoldRange) => a.from <= b.to && b.from <= a.to;

/** Whether two answers for a file are the same, so that nothing has to be built again. */
export function sameDiff(a: GitDiff, b: GitDiff): boolean {
  if (a.kind === 'text' && b.kind === 'text') {
    return a.complete === b.complete && a.lineEndingsOnly === b.lineEndingsOnly && a.lines.length === b.lines.length
      && a.lines.every((line, index) => {
        const other = b.lines[index];
        return line.text === other.text && line.type === other.type && line.oldLine === other.oldLine
          && line.newLine === other.newLine;
      });
  }
  if (a.kind === 'binary' && b.kind === 'binary') {
    return a.oldSize === b.oldSize && a.newSize === b.newSize;
  }
  return a.kind === b.kind;
}

/** A line whose text has no changed words, such as an unchanged line or one without a partner. */
export function wholeLineRow(line: DiffLine): DiffRow & { kind: 'line'; } {
  const text = visibleText(line.text);
  return { kind: 'line', line, parts: text === '' ? [] : [ { text, changed: false } ] };
}

/**
 * The rows of a diff (GA-14): unchanged runs over 8 lines are folded, and a
 * removed and an added line next to each other, paired up in order, have their
 * changed words marked. A diff that is not `complete` has only git's hunks: a
 * fold without lines stands for what lies before, between and after them. A pure
 * function of the API's answer.
 */
export function diffRows(lines: DiffLine[], complete = true): DiffRow[] {
  const rows: DiffRow[] = [];
  const budget = { chars: MAX_WORD_DIFF_TOTAL_CHARS };
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
    rows.push(...(type === 'context' ? contextRows(block) : changedRows(block, budget)));
    for (const line of block) {
      nextOld = line.oldLine === null ? nextOld : line.oldLine + 1;
      nextNew = line.newLine === null ? nextNew : line.newLine + 1;
    }
    index = end;
  }
  if (!complete && endsWithFullContext(lines)) {
    rows.push({ kind: 'fold', hidden: [] });
  }
  return rows;
}

/** Whether more of the file may follow the last hunk. */
function endsWithFullContext(lines: DiffLine[]): boolean {
  const lastChange = lines.findLastIndex(line => line.type !== 'context');
  return lastChange !== -1 && lines.length - 1 - lastChange >= GIT_CONTEXT_LINES;
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
function changedRows(block: DiffLine[], budget: { chars: number; }): DiffRow[] {
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
    const oldText = block[pair].text;
    const newText = block[added + pair].text;
    const chars = oldText.length + newText.length;
    if (chars <= budget.chars && oldText.length <= MAX_WORD_DIFF_CHARS && newText.length <= MAX_WORD_DIFF_CHARS) {
      budget.chars -= chars;
      [ rows[pair].parts, rows[added + pair].parts ] = changedWords(oldText, newText);
    }
  }
  return rows;
}

/** The two lines' text in parts, with the words that differ marked. */
function changedWords(before: string, after: string): [ DiffLinePart[], DiffLinePart[] ] {
  const changes = diffWordsWithSpace(visibleText(before), visibleText(after));
  return [
    changes.filter(change => !change.added).map(change => ({ text: change.value, changed: change.removed ?? false })),
    changes.filter(change => !change.removed).map(change => ({ text: change.value, changed: change.added ?? false }))
  ];
}
