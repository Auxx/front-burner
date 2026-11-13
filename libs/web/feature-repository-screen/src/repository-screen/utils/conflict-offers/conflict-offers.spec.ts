import type { GitConflictFile, GitConflictKind } from '@front-burner/shared-contracts';

import { conflictOffers } from './conflict-offers';

function file(kind: GitConflictKind, changes: Partial<GitConflictFile> = {}): GitConflictFile {
  return {
    path: 'a.png',
    kind,
    resolved: false,
    editable: false,
    edited: false,
    oursSize: 1,
    theirsSize: 1,
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
