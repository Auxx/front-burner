import { resolvePreviewLink } from './preview-links';

describe('resolvePreviewLink', () => {
  it.each([ 'http://example.com', 'https://example.com/a#b', 'mailto:a@example.com', 'HTTPS://x', '//example.com' ])(
    'opens %s in a new tab',
    href => {
      expect(resolvePreviewLink('docs/a.md', href)).toEqual({ kind: 'external' });
    }
  );

  it('scrolls to a prefixed heading', () => {
    expect(resolvePreviewLink('docs/a.md', '#install')).toEqual({ kind: 'fragment', id: 'install' });
    expect(resolvePreviewLink('docs/a.md', '#user-content-fn-1')).toEqual({
      kind: 'fragment',
      id: 'user-content-fn-1'
    });
  });

  it('resolves ../guide.md from docs/a/b.md as docs/guide.md', () => {
    expect(resolvePreviewLink('docs/a/b.md', '../guide.md')).toEqual({
      kind: 'path',
      path: 'docs/guide.md',
      fragment: null
    });
  });

  it('resolves a path in the same folder, percent-decoded', () => {
    expect(resolvePreviewLink('docs/a.md', './My%20Notes.md')).toEqual({
      kind: 'path',
      path: 'docs/My Notes.md',
      fragment: null
    });
  });

  it('resolves /x.md from the root', () => {
    expect(resolvePreviewLink('docs/a/b.md', '/x.md')).toEqual({ kind: 'path', path: 'x.md', fragment: null });
  });

  it('keeps the fragment of a path link', () => {
    expect(resolvePreviewLink('a.md', 'b.md?plain=1#set-up')).toEqual({
      kind: 'path',
      path: 'b.md',
      fragment: 'set-up'
    });
  });

  it('ignores a link above the root', () => {
    expect(resolvePreviewLink('docs/a.md', '../../../etc/passwd')).toEqual({ kind: 'none' });
    expect(resolvePreviewLink('a.md', '/../x.md')).toEqual({ kind: 'none' });
  });

  it('ignores a link to the root, a bad escape or another scheme', () => {
    expect(resolvePreviewLink('docs/a.md', '..')).toEqual({ kind: 'none' });
    expect(resolvePreviewLink('a.md', '%E0%A4%A.md')).toEqual({ kind: 'none' });
    expect(resolvePreviewLink('a.md', 'ftp://x')).toEqual({ kind: 'none' });
    expect(resolvePreviewLink('a.md', '')).toEqual({ kind: 'none' });
  });
});
