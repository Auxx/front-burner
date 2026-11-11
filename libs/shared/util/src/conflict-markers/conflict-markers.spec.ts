import { hasConflictMarkers } from './conflict-markers';

describe('hasConflictMarkers', () => {
  it('recognises only GC-14\'s lines', () => {
    for (const text of [ '<<<<<<< main\n', 'text\n>>>>>>> origin/main', 'a\n=======\nb\n', '<<<<<<< \n' ]) {
      expect({ text, found: hasConflictMarkers(text) }).toEqual({ text, found: true });
    }
    for (
      const text of [
        // Without its space, or with more of its characters.
        '<<<<<<<\n',
        '>>>>>>>main\n',
        '<<<<<<<< main\n',
        // A setext heading's underline, a table's rule or a code block's line: not exactly seven.
        'Title\n========\n',
        '| a |\n| ======= |\n',
        '    =======\n',
        '======= \n',
        '<<<<<< main\n'
      ]
    ) {
      expect({ text, found: hasConflictMarkers(text) }).toEqual({ text, found: false });
    }
  });

  it('ignores a marker in the middle of a line', () => {
    expect(hasConflictMarkers('text <<<<<<< main\n')).toBe(false);
    expect(hasConflictMarkers('text =======\n')).toBe(false);
    expect(hasConflictMarkers('text >>>>>>> theirs')).toBe(false);
    // Only a line feed breaks a line; JavaScript's `^` would also start one after these.
    expect(hasConflictMarkers('text\r<<<<<<< main')).toBe(false);
    expect(hasConflictMarkers('text =======')).toBe(false);
  });

  it('treats a line break of either kind alike', () => {
    expect(hasConflictMarkers('a\r\n=======\r\nb\r\n')).toBe(true);
    expect(hasConflictMarkers('a\r\n=======')).toBe(true);
    expect(hasConflictMarkers('<<<<<<< main\r\n')).toBe(true);
    expect(hasConflictMarkers('a\r\n=======\r\r\n')).toBe(false);
  });

  it('has none in an empty file', () => {
    expect(hasConflictMarkers('')).toBe(false);
    expect(hasConflictMarkers('\n')).toBe(false);
  });
});
