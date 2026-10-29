import { signal } from '@angular/core';

import { entryNameField } from './entry-name-field';

describe('entryNameField', () => {
  it('adds the Markdown extension to a file\'s name', () => {
    const name = signal('notes');
    const field = entryNameField(name, { kind: 'file', siblings: () => [] });

    expect(field.finalName()).toBe('notes.md');
    name.set('notes.txt');
    expect(field.finalName()).toBe('notes.txt.md');
    name.set('notes.MDX');
    expect(field.finalName()).toBe('notes.MDX');
  });

  it('keeps a folder\'s name, in NFC', () => {
    const field = entryNameField(() => 'café', { kind: 'folder', siblings: () => [] });

    expect(field.finalName()).toBe('café');
  });

  it('finds each problem', () => {
    const name = signal('');
    const field = entryNameField(name, { kind: 'folder', siblings: () => [] });
    const cases: [string, string | null][] = [
      [ '', 'empty' ],
      [ '..', 'dot' ],
      [ 'a/b', 'separator' ],
      [ 'a\tb', 'control' ],
      [ ' a', 'edge-space' ],
      [ '.GIT', 'git' ],
      [ 'a'.repeat(256), 'too-long' ],
      [ 'docs', null ]
    ];
    for (const [ value, problem ] of cases) {
      name.set(value);
      expect(field.problem()).toBe(problem);
    }
  });

  it('counts the added extension in the length', () => {
    const field = entryNameField(() => 'a'.repeat(254), { kind: 'file', siblings: () => [] });

    expect(field.problem()).toBe('too-long');
  });

  it('flags a clash with a sibling ignoring case', () => {
    const field = entryNameField(() => 'README', { kind: 'file', siblings: () => [ 'readme.md' ] });

    expect(field.problem()).toBe('name-taken');
  });

  it('allows a case-only rename of the entry itself', () => {
    const name = signal('README.md');
    const field = entryNameField(name, { kind: 'file', siblings: () => [ 'readme.md', 'guide.md' ], current: 'readme.md' });

    expect(field.problem()).toBeNull();
    name.set('Guide.md');
    expect(field.problem()).toBe('name-taken');
  });
});
