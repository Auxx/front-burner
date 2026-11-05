import { GitStatusSchema } from './git-status.schema';

describe('GitStatusSchema', () => {
  const status = {
    branch: 'main',
    noCommits: false,
    upstream: 'origin/main',
    ahead: 2,
    behind: 3,
    mergeInProgress: false,
    changes: [ { path: 'docs/a.md', state: 'modified' }, { path: 'b.md', state: 'added' }, {
      path: 'c.md',
      state: 'deleted'
    } ],
    lastCommit: { amendable: true, message: 'Subject\n\nBody' }
  };

  it('parses a status', () => {
    expect(GitStatusSchema.parse(status)).toEqual(status);
  });

  it('parses no commits, and a last commit that cannot be amended', () => {
    expect(GitStatusSchema.parse({ ...status, lastCommit: null }).lastCommit).toBeNull();
    const pushed = { amendable: false, message: null };
    expect(GitStatusSchema.parse({ ...status, lastCommit: pushed }).lastCommit).toEqual(pushed);
  });

  it('needs the last commit', () => {
    const { lastCommit: _lastCommit, ...without } = status;
    expect(GitStatusSchema.safeParse(without).success).toBe(false);
  });

  it('parses a detached HEAD and an unpublished branch', () => {
    const detached = { ...status, branch: null, upstream: null, ahead: 0, behind: 0 };
    expect(GitStatusSchema.parse(detached)).toEqual(detached);
  });

  it('refuses an unknown state', () => {
    const renamed = { ...status, changes: [ { path: 'a.md', state: 'renamed' } ] };
    expect(GitStatusSchema.safeParse(renamed).success).toBe(false);
  });

  it('refuses a negative count', () => {
    expect(GitStatusSchema.safeParse({ ...status, ahead: -1 }).success).toBe(false);
  });
});
