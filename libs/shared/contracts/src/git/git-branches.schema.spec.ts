import { GitBranchListSchema, GitNewBranchRequestSchema, GitSwitchRequestSchema } from './git-branches.schema';

describe('GitSwitchRequestSchema', () => {
  it('needs a name, and whether it is a remote branch', () => {
    expect(GitSwitchRequestSchema.parse({ name: 'feature', remote: true })).toEqual({ name: 'feature', remote: true });
    expect(GitSwitchRequestSchema.safeParse({ name: 'feature' }).success).toBe(false);
    expect(GitSwitchRequestSchema.safeParse({ remote: false }).success).toBe(false);
  });
});

describe('GitNewBranchRequestSchema', () => {
  it('leaves a name\'s rules to git, as they are git\'s (GA-38)', () => {
    expect(GitNewBranchRequestSchema.parse({ name: 'bad..name' })).toEqual({ name: 'bad..name' });
    expect(GitNewBranchRequestSchema.safeParse({}).success).toBe(false);
  });
});

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
