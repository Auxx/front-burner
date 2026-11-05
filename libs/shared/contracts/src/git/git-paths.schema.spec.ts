import { GIT_PATH_MAX_LENGTH, GIT_PATHS_MAX, GitPathsSchema } from './git-paths.schema';

describe('GitPathsSchema', () => {
  const accepts = (paths: unknown) => GitPathsSchema.safeParse({ paths }).success;

  it('accepts a list of paths', () => {
    expect(accepts([ 'a.md', 'docs/b.md' ])).toBe(true);
  });

  it('accepts as many paths as the limit, and no more', () => {
    expect(accepts(Array.from({ length: GIT_PATHS_MAX }, () => 'a.md'))).toBe(true);
    expect(accepts(Array.from({ length: GIT_PATHS_MAX + 1 }, () => 'a.md'))).toBe(false);
  });

  it('refuses an empty list', () => {
    expect(accepts([])).toBe(false);
  });

  it('refuses an empty path and one over the limit', () => {
    expect(accepts([ '' ])).toBe(false);
    expect(accepts([ 'a'.repeat(GIT_PATH_MAX_LENGTH) ])).toBe(true);
    expect(accepts([ 'a'.repeat(GIT_PATH_MAX_LENGTH + 1) ])).toBe(false);
  });
});
