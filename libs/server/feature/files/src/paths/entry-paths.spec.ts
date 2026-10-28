import { isGitName, joinPath, splitPath } from './entry-paths';

describe('entry paths', () => {
  it('splits a path into its parent and name', () => {
    expect(splitPath('readme.md')).toEqual([ '', 'readme.md' ]);
    expect(splitPath('docs/api/readme.md')).toEqual([ 'docs/api', 'readme.md' ]);
  });

  it('joins a folder and a name', () => {
    expect(joinPath('', 'readme.md')).toBe('readme.md');
    expect(joinPath('docs/api', 'readme.md')).toBe('docs/api/readme.md');
  });

  it('recognises .git in any case', () => {
    expect([ '.git', '.GIT', '.Git' ].every(isGitName)).toBe(true);
    expect([ 'git', '.github', '.git.md' ].some(isGitName)).toBe(false);
  });
});
