import { GitConflictFileSchema, GitMergeStateSchema } from './git-merge.schema';

describe('GitMergeStateSchema', () => {
  const file = {
    path: 'docs/a.md',
    kind: 'deleted-by-me',
    resolved: false,
    editable: false,
    mineSize: null,
    theirsSize: 12
  };

  it('parses a merge in progress', () => {
    const state = {
      into: 'main',
      from: 'origin/main',
      files: [ file ],
      otherFiles: [ 'b.md' ],
      message: 'Merge remote-tracking branch \'origin/main\''
    };
    expect(GitMergeStateSchema.parse(state)).toEqual(state);
  });

  it('needs a known kind and a size that can be one', () => {
    expect(GitConflictFileSchema.safeParse({ ...file, kind: 'renamed' }).success).toBe(false);
    expect(GitConflictFileSchema.safeParse({ ...file, theirsSize: -1 }).success).toBe(false);
  });
});
