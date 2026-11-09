import { GitBranchListSchema } from './git-branches.schema';

describe('GitBranchListSchema', () => {
  const list = {
    current: 'main',
    local: [ { name: 'main', upstream: 'origin/main' }, { name: 'draft', upstream: null } ],
    remote: [ { name: 'origin/feature', branch: 'feature' } ],
    singleBranch: false
  };

  it('parses the branches, and a detached HEAD without a current one', () => {
    expect(GitBranchListSchema.parse(list)).toEqual(list);
    expect(GitBranchListSchema.parse({ ...list, current: null })).toEqual({ ...list, current: null });
  });

  it('needs to know whether it is a single-branch clone', () => {
    expect(GitBranchListSchema.safeParse({ ...list, singleBranch: undefined }).success).toBe(false);
  });

  it('needs a remote branch\'s name without the remote', () => {
    const remote = [ { name: 'origin/feature' } ];
    expect(GitBranchListSchema.safeParse({ ...list, remote }).success).toBe(false);
  });
});
