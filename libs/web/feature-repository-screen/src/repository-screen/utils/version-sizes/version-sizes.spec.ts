import type { GitConflictFile } from '@front-burner/shared-contracts';

import { versionSizes } from './version-sizes';

function file(changes: Partial<GitConflictFile>): GitConflictFile {
  return {
    path: 'a.md',
    kind: 'both-changed',
    resolved: false,
    editable: true,
    edited: false,
    oursSize: 1,
    theirsSize: 1,
    ...changes
  };
}

describe('versionSizes', () => {
  it('formats the size of each version', () => {
    expect(versionSizes(file({ oursSize: 1536, theirsSize: 20 }))).toEqual([
      { side: 'mine', size: '1.5 KB' },
      { side: 'theirs', size: '20 B' }
    ]);
  });

  it('says which version the deleting side has not got', () => {
    expect(versionSizes(file({ kind: 'deleted-by-us', oursSize: null }))).toEqual([
      { side: 'mine', size: 'deleted' },
      { side: 'theirs', size: '1 B' }
    ]);
    expect(versionSizes(file({ kind: 'deleted-by-them', theirsSize: null }))).toEqual([
      { side: 'mine', size: '1 B' },
      { side: 'theirs', size: 'deleted' }
    ]);
  });

  it('has no size for a version that exists without one, such as a submodule', () => {
    expect(versionSizes(file({ oursSize: null }))[0]).toEqual({ side: 'mine', size: 'none' });
  });
});
