import type { GitConflictFile, GitConflictKind } from '@front-burner/shared-contracts';

import { conflictOffers, shownVersions } from './conflict-offers';

function file(kind: GitConflictKind, changes: Partial<GitConflictFile> = {}): GitConflictFile {
  return {
    path: 'a.png',
    kind,
    resolved: false,
    editable: false,
    edited: false,
    oursSize: 1,
    theirsSize: 1,
    oursShowable: false,
    theirsShowable: false,
    ...changes
  };
}

describe('conflictOffers', () => {
  it('offers what each kind allows', () => {
    expect(conflictOffers(file('both-changed'))).toEqual([ 'ours', 'theirs' ]);
    expect(conflictOffers(file('both-added'))).toEqual([ 'ours', 'theirs' ]);
    expect(conflictOffers(file('deleted-by-us', { oursSize: null }))).toEqual([ 'keep', 'delete' ]);
    expect(conflictOffers(file('deleted-by-them', { theirsSize: null }))).toEqual([ 'keep', 'delete' ]);
  });

  it('offers the same whole versions for an editable Markdown file', () => {
    expect(conflictOffers(file('both-changed', { path: 'guide.md', editable: true }))).toEqual([ 'ours', 'theirs' ]);
  });

  it('offers nothing for a resolved file', () => {
    expect(conflictOffers(file('both-changed', { resolved: true }))).toEqual([]);
    expect(conflictOffers(file('deleted-by-them', { resolved: true }))).toEqual([]);
  });
});

describe('shownVersions', () => {
  const markdown = { path: 'guide.md', oursShowable: true, theirsShowable: true };

  it('shows both versions the backend says can be shown, resolved or not, mine first', () => {
    expect(shownVersions(file('both-changed', markdown))).toEqual([ 'ours', 'theirs' ]);
    expect(shownVersions(file('both-added', { ...markdown, resolved: true }))).toEqual([ 'ours', 'theirs' ]);
  });

  it('shows only the side that can be shown', () => {
    expect(shownVersions(file('deleted-by-us', { ...markdown, oursSize: null, oursShowable: false })))
      .toEqual([ 'theirs' ]);
    expect(shownVersions(file('deleted-by-them', { ...markdown, theirsSize: null, theirsShowable: false })))
      .toEqual([ 'ours' ]);
  });

  it('shows nothing the backend refuses, whatever its name and size, such as a symbolic link', () => {
    expect(shownVersions(file('both-changed', { path: 'link.md' }))).toEqual([]);
    expect(shownVersions(file('both-changed'))).toEqual([]);
  });
});
