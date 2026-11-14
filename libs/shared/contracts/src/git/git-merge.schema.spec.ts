import {
  GitConflictFileSchema,
  GitConflictPathSchema,
  GitMergeCommitRequestSchema,
  GitMergeStateSchema,
  GitMergeVersionQuerySchema,
  GitResolveRequestSchema
} from './git-merge.schema';

describe('GitMergeStateSchema', () => {
  const file = {
    path: 'docs/a.md',
    kind: 'deleted-by-us',
    resolved: false,
    editable: false,
    edited: false,
    oursSize: null,
    theirsSize: 12,
    oursShowable: false,
    theirsShowable: true
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

  it('says whether the file was edited', () => {
    const { edited: _edited, ...withoutEdited } = file;
    expect(GitConflictFileSchema.safeParse(withoutEdited).success).toBe(false);
    expect(GitConflictFileSchema.parse({ ...file, edited: true }).edited).toBe(true);
  });
});

describe('GitConflictPathSchema', () => {
  it('parses a path, and refuses an empty one or one that is too long', () => {
    expect(GitConflictPathSchema.parse({ path: 'docs/a.md' })).toEqual({ path: 'docs/a.md' });
    expect(GitConflictPathSchema.safeParse({ path: '' }).success).toBe(false);
    expect(GitConflictPathSchema.safeParse({ path: 'a'.repeat(4097) }).success).toBe(false);
  });
});

describe('GitMergeVersionQuerySchema', () => {
  it('parses a valid query', () => {
    const query = { path: 'notes.md', side: 'ours' };
    expect(GitMergeVersionQuerySchema.parse(query)).toEqual(query);
  });

  it('refuses an empty path or a path that is too long', () => {
    expect(GitMergeVersionQuerySchema.safeParse({ path: '', side: 'ours' }).success).toBe(false);
    expect(GitMergeVersionQuerySchema.safeParse({ path: 'a'.repeat(4097), side: 'theirs' }).success).toBe(false);
  });

  it('refuses an unknown side', () => {
    expect(GitMergeVersionQuerySchema.safeParse({ path: 'notes.md', side: 'base' }).success).toBe(false);
  });
});

describe('GitResolveRequestSchema', () => {
  it('parses each resolution, with and without force', () => {
    for (const resolution of [ 'mark-resolved', 'ours', 'theirs', 'keep', 'delete' ]) {
      const request = { path: 'notes.md', resolution };
      expect(GitResolveRequestSchema.parse(request)).toEqual(request);
    }
    const forced = { path: 'notes.md', resolution: 'mark-resolved', force: true };
    expect(GitResolveRequestSchema.parse(forced)).toEqual(forced);
  });

  it('refuses an unknown resolution, an empty path or a path that is too long', () => {
    expect(GitResolveRequestSchema.safeParse({ path: 'notes.md', resolution: 'both' }).success).toBe(false);
    expect(GitResolveRequestSchema.safeParse({ path: '', resolution: 'ours' }).success).toBe(false);
    expect(GitResolveRequestSchema.safeParse({ path: 'a'.repeat(4097), resolution: 'ours' }).success).toBe(false);
  });
});

describe('GitMergeCommitRequestSchema', () => {
  it('keeps the message as written, lines starting with # included', () => {
    const request = { message: 'Merge origin/main\n\n# kept\n' };
    expect(GitMergeCommitRequestSchema.parse(request)).toEqual(request);
  });

  it('refuses a message that is empty, only spaces or too long', () => {
    expect(GitMergeCommitRequestSchema.safeParse({ message: '' }).success).toBe(false);
    expect(GitMergeCommitRequestSchema.safeParse({ message: ' \n\t' }).success).toBe(false);
    expect(GitMergeCommitRequestSchema.safeParse({ message: 'a'.repeat(65_537) }).success).toBe(false);
  });
});
