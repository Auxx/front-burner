import {
  compareEntryNames,
  entryNameProblem,
  isMarkdownName,
  sameEntryName,
  withMarkdownExtension
} from './entry-name';

describe('entry names', () => {
  it('recognises Markdown extensions in any case', () => {
    for (const name of [ 'A.MD', 'b.Markdown', 'c.mdx' ]) {
      expect(isMarkdownName(name)).toBe(true);
    }
    for (const name of [ 'd.txt', 'md', '.md.bak' ]) {
      expect(isMarkdownName(name)).toBe(false);
    }
  });

  it('appends .md as FB-29 says', () => {
    expect(withMarkdownExtension('notes')).toBe('notes.md');
    expect(withMarkdownExtension('notes.txt')).toBe('notes.txt.md');
    expect(withMarkdownExtension('notes.MDX')).toBe('notes.MDX');
  });

  it('reports each problem', () => {
    const rows: [ string, string | null ][] = [
      [ '', 'empty' ],
      [ '.', 'dot' ],
      [ '..', 'dot' ],
      [ 'a/b', 'separator' ],
      [ 'a\\b', 'separator' ],
      [ 'a\u0000b', 'control' ],
      [ 'a\u001fb', 'control' ],
      [ 'a\u007fb', 'control' ],
      [ 'a\u0085b', 'control' ],
      [ 'a\u009bb', 'control' ],
      [ 'a\u00a0b', null ],
      [ ' a', 'edge-space' ],
      [ 'a ', 'edge-space' ],
      [ '.git', 'git' ],
      [ '.GIT', 'git' ],
      [ 'é'.repeat(128), 'too-long' ],
      [ '.gitignore', null ],
      [ 'notes.md', null ]
    ];
    for (const [ name, problem ] of rows) {
      expect({ name, problem: entryNameProblem(name) }).toEqual({ name, problem });
    }
  });

  it('counts bytes in NFC', () => {
    expect(entryNameProblem('é'.repeat(127) + 'a')).toBeNull();
    expect(entryNameProblem('é'.repeat(127) + 'ab')).toBe('too-long');
  });

  it('compares names in NFC ignoring case', () => {
    expect(sameEntryName('Café.md', 'café.MD')).toBe(true);
    expect(sameEntryName('a.md', 'b.md')).toBe(false);
  });

  it('sorts numbers naturally', () => {
    expect([ '10-deploy.md', '2-setup.md', 'B.md', 'a.md' ].sort(compareEntryNames)).toEqual(
      [ '2-setup.md', '10-deploy.md', 'a.md', 'B.md' ]
    );
  });

  it('sorts the same way in every locale', () => {
    expect([ 'z.md', 'ä.md', 'a.md' ].sort(compareEntryNames)).toEqual([ 'a.md', 'ä.md', 'z.md' ]);
  });

  it('breaks ties so the order is total', () => {
    expect([ 'a.md', 'A.md' ].sort(compareEntryNames)).toEqual([ 'A.md', 'a.md' ]);
    expect([ 'A.md', 'a.md' ].sort(compareEntryNames)).toEqual([ 'A.md', 'a.md' ]);
  });
});
