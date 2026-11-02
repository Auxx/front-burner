import { parseUnifiedDiff } from './git-diff';

const HEADER = 'diff --git a/a.md b/a.md\nindex 1111111..2222222 100644\n--- a/a.md\n+++ b/a.md\n';

describe('parseUnifiedDiff', () => {
  it('numbers context, removed and added lines', () => {
    const diff = `${HEADER}@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n`;

    expect(parseUnifiedDiff(diff)).toEqual([
      { type: 'context', oldLine: 1, newLine: 1, text: 'one' },
      { type: 'removed', oldLine: 2, newLine: null, text: 'two' },
      { type: 'added', oldLine: null, newLine: 2, text: 'TWO' },
      { type: 'context', oldLine: 3, newLine: 3, text: 'three' }
    ]);
  });

  it('reads several hunks and counts omitted as 1', () => {
    const diff = `${HEADER}@@ -2 +2 @@\n-b\n+B\n@@ -10,2 +10,3 @@\n j\n+new\n k\n`;

    expect(parseUnifiedDiff(diff).map(line => [ line.type, line.oldLine, line.newLine ])).toEqual([
      [ 'removed', 2, null ],
      [ 'added', null, 2 ],
      [ 'context', 10, 10 ],
      [ 'added', null, 11 ],
      [ 'context', 11, 12 ]
    ]);
  });

  it('reads content lines that look like headers', () => {
    const diff = `${HEADER}@@ -1,2 +1,2 @@\n---- a\n++++ b\n @@ -1 +1 @@\n`;

    expect(parseUnifiedDiff(diff)).toEqual([
      { type: 'removed', oldLine: 1, newLine: null, text: '--- a' },
      { type: 'added', oldLine: null, newLine: 1, text: '+++ b' },
      { type: 'context', oldLine: 2, newLine: 2, text: '@@ -1 +1 @@' }
    ]);
  });

  it('does not read the no-newline marker as a line', () => {
    const diff = `${HEADER}@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n`;

    expect(parseUnifiedDiff(diff)).toEqual([
      { type: 'removed', oldLine: 1, newLine: null, text: 'old' },
      { type: 'added', oldLine: null, newLine: 1, text: 'new' }
    ]);
  });

  it('keeps a trailing carriage return', () => {
    const diff = `${HEADER}@@ -1 +1 @@\n-line\n+line\r\n`;

    expect(parseUnifiedDiff(diff)[1]).toEqual({ type: 'added', oldLine: null, newLine: 1, text: 'line\r' });
  });

  it('answers no lines for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
