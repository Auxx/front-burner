import type { DiffLine } from '@front-burner/shared-contracts';

import { type DiffRow, diffRows, wholeLineRow } from './diff-rows';

/** `count` unchanged lines, numbered from `from` on both sides. */
function context(count: number, from = 1): DiffLine[] {
  return Array.from({ length: count }, (_, index) => ({
    type: 'context' as const,
    oldLine: from + index,
    newLine: from + index,
    text: `line ${from + index}`
  }));
}

const removed = (text: string, oldLine = 1): DiffLine => ({ type: 'removed', oldLine, newLine: null, text });
const added = (text: string, newLine = 1): DiffLine => ({ type: 'added', oldLine: null, newLine, text });

type LineRow = Extract<DiffRow, { kind: 'line'; }>;
const lineRows = (rows: DiffRow[]) => rows.filter((row): row is LineRow => row.kind === 'line');
const kinds = (rows: DiffRow[]) => rows.map(row => row.kind);

describe('diffRows', () => {
  it('folds an unchanged run over 8 lines, keeping 3 on each side', () => {
    const rows = diffRows(context(9));

    expect(kinds(rows)).toEqual([ 'line', 'line', 'line', 'fold', 'line', 'line', 'line' ]);
    const fold = rows[3] as Extract<DiffRow, { kind: 'fold'; }>;
    expect(fold.hidden.map(line => line.oldLine)).toEqual([ 4, 5, 6 ]);
    expect(lineRows(rows).map(row => row.line.oldLine)).toEqual([ 1, 2, 3, 7, 8, 9 ]);
  });

  it('does not fold a short run', () => {
    expect(kinds(diffRows(context(8)))).toEqual(Array.from({ length: 8 }, () => 'line'));
  });

  it('marks a gap between the hunks of an incomplete diff as a fold with nothing to open', () => {
    const rows = diffRows([ ...context(2), ...context(2, 40) ]);

    expect(kinds(rows)).toEqual([ 'line', 'line', 'fold', 'line', 'line' ]);
    expect(rows[2]).toEqual({ kind: 'fold', hidden: [] });
  });

  it('marks the lines before the first hunk of an incomplete diff the same way', () => {
    expect(kinds(diffRows(context(1, 40)))).toEqual([ 'fold', 'line' ]);
  });

  it('marks the changed words of a pair of lines', () => {
    const [ before, after ] = lineRows(diffRows([ removed('the quick fox'), added('the slow fox') ]));

    expect(before.parts).toEqual([
      { text: 'the ', changed: false },
      { text: 'quick', changed: true },
      { text: ' fox', changed: false }
    ]);
    expect(after.parts).toEqual([
      { text: 'the ', changed: false },
      { text: 'slow', changed: true },
      { text: ' fox', changed: false }
    ]);
  });

  it('pairs removed and added lines in order', () => {
    const rows = lineRows(diffRows([ removed('one a', 1), removed('two a', 2), added('one b', 1), added('two b', 2) ]));

    expect(rows.map(row => row.parts.find(part => part.changed)?.text)).toEqual([ 'a', 'a', 'b', 'b' ]);
    expect(rows.map(row => row.parts[0].text)).toEqual([ 'one ', 'two ', 'one ', 'two ' ]);
  });

  it('marks whole lines without a partner', () => {
    const rows = lineRows(diffRows([ removed('one a', 1), removed('two', 2), added('one b', 1) ]));

    // The sign and the colour of the line say it is changed; no word stands out.
    expect(rows[1].parts).toEqual([ { text: 'two', changed: false } ]);
  });

  it('skips word highlighting for long lines', () => {
    const long = 'word '.repeat(401);
    const [ before, after ] = lineRows(diffRows([ removed(long), added(`${long}more`) ]));

    expect(before.parts).toEqual([ { text: long, changed: false } ]);
    expect(after.parts).toEqual([ { text: `${long}more`, changed: false } ]);
  });

  it('skips word highlighting for long runs', () => {
    const lines = [
      ...Array.from({ length: 10_000 }, (_, index) => removed(`old ${index}`, index + 1)),
      ...Array.from({ length: 10_000 }, (_, index) => added(`new ${index}`, index + 1))
    ];

    const rows = lineRows(diffRows(lines));

    expect(rows).toHaveLength(20_000);
    expect(rows.some(row => row.parts.some(part => part.changed))).toBe(false);
  });

  it('still highlights a run of 500 lines', () => {
    const lines = [
      ...Array.from({ length: 250 }, (_, index) => removed(`old ${index}`, index + 1)),
      ...Array.from({ length: 250 }, (_, index) => added(`new ${index}`, index + 1))
    ];

    expect(lineRows(diffRows(lines))[0].parts).toEqual([
      { text: 'old', changed: true },
      { text: ' 0', changed: false }
    ]);
  });

  it('shows a trailing carriage return as a mark, changed when only one side has it', () => {
    const [ before, after ] = lineRows(diffRows([ removed('text\r'), added('text') ]));

    expect(before.parts).toEqual([ { text: 'text', changed: false }, { text: '␍', changed: true } ]);
    expect(after.parts).toEqual([ { text: 'text', changed: false } ]);
    expect(wholeLineRow(context(1)[0]).parts).toEqual([ { text: 'line 1', changed: false } ]);
    expect(wholeLineRow({ ...context(1)[0], text: 'a\r' }).parts).toEqual([ { text: 'a␍', changed: false } ]);
  });

  it('leaves an empty line without parts', () => {
    expect(wholeLineRow({ ...context(1)[0], text: '' }).parts).toEqual([]);
  });
});
