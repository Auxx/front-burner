import { GitDiffQuerySchema, GitDiffSchema } from './git-diff.schema';

describe('GitDiffSchema', () => {
  const accepts = (value: unknown) => GitDiffSchema.safeParse(value).success;

  it('parses each kind', () => {
    const text = {
      kind: 'text',
      lines: [
        { type: 'removed', oldLine: 1, newLine: null, text: 'old' },
        { type: 'added', oldLine: null, newLine: 1, text: 'new\r' }
      ],
      complete: true,
      lineEndingsOnly: false
    };
    const binary = { kind: 'binary', oldSize: null, newSize: 12 };
    const tooLarge = { kind: 'too-large' };

    expect(GitDiffSchema.parse(text)).toEqual(text);
    expect(GitDiffSchema.parse(binary)).toEqual(binary);
    expect(GitDiffSchema.parse(tooLarge)).toEqual(tooLarge);
  });

  it('refuses an unknown kind and an unknown line type', () => {
    expect(accepts({ kind: 'renamed' })).toBe(false);
    expect(accepts({
      kind: 'text',
      lines: [ { type: 'moved', oldLine: 1, newLine: 1, text: '' } ],
      complete: true,
      lineEndingsOnly: false
    })).toBe(false);
  });
});

describe('GitDiffQuerySchema', () => {
  it('needs a path', () => {
    expect(GitDiffQuerySchema.safeParse({ path: '' }).success).toBe(false);
    expect(GitDiffQuerySchema.safeParse({ path: 'docs/a.md' }).success).toBe(true);
  });
});
