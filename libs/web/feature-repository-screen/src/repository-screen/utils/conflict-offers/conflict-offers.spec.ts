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
  it('shows both versions of a Markdown file, resolved or not', () => {
    expect(shownVersions(file('both-changed', { path: 'docs/guide.md' }))).toEqual([ 'ours', 'theirs' ]);
    expect(shownVersions(file('both-added', { path: 'README.MARKDOWN', resolved: true }))).toEqual([
      'ours',
      'theirs'
    ]);
  });

  it('shows no version a side deleted, or that has no size', () => {
    expect(shownVersions(file('deleted-by-us', { path: 'a.md', oursSize: null }))).toEqual([ 'theirs' ]);
    expect(shownVersions(file('deleted-by-them', { path: 'a.md', theirsSize: null }))).toEqual([ 'ours' ]);
  });

  it('shows a version up to the editor\'s limit, and none above it', () => {
    expect(shownVersions(file('both-changed', { path: 'a.md', oursSize: 1_048_576, theirsSize: 1_048_577 })))
      .toEqual([ 'ours' ]);
  });

  it('shows nothing for a file that is not Markdown', () => {
    expect(shownVersions(file('both-changed'))).toEqual([]);
    expect(shownVersions(file('both-changed', { path: 'docs/.md' }))).toEqual([]);
  });
});
