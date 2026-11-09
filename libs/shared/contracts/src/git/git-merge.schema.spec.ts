import {
  GitConflictFileSchema,
  GitMergeSideSchema,
  GitMergeStateSchema,
  GitMergeVersionQuerySchema,
  GitMergeVersionSchema
} from './git-merge.schema';

describe('GitMergeStateSchema', () => {
  const file = {
    path: 'docs/a.md',
    kind: 'deleted-by-us',
    resolved: false,
    editable: false,
    oursSize: null,
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

describe('GitMergeVersionQuerySchema', () => {
  it('parses valid queries', () => {
    expect(GitMergeVersionQuerySchema.parse({ path: 'a.md', side: 'ours' })).toEqual({ path: 'a.md', side: 'ours' });
    expect(GitMergeVersionQuerySchema.parse({ path: 'b.md', side: 'theirs' })).toEqual({
      path: 'b.md',
      side: 'theirs'
    });
  });

  it('refuses an invalid side or empty path', () => {
    expect(GitMergeVersionQuerySchema.safeParse({ path: 'a.md', side: 'mine' }).success).toBe(false);
    expect(GitMergeVersionQuerySchema.safeParse({ path: '', side: 'ours' }).success).toBe(false);
  });
});

describe('GitMergeVersionSchema', () => {
  it('parses a version content', () => {
    expect(GitMergeVersionSchema.parse({ content: 'test content' })).toEqual({ content: 'test content' });
  });
});
