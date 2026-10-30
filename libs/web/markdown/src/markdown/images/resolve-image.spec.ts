import { resolveImageAddress } from './resolve-image';

describe('resolveImageAddress', () => {
  it('AC-EDIT-003.1: resolves relative, parent and root paths from docs/guide.md', () => {
    expect(resolveImageAddress('docs/guide.md', 'img/flow.png')).toEqual({
      kind: 'repository',
      path: 'docs/img/flow.png'
    });
    expect(resolveImageAddress('docs/guide.md', './img/flow.png')).toEqual({
      kind: 'repository',
      path: 'docs/img/flow.png'
    });
    expect(resolveImageAddress('docs/guide.md', '../logo.svg')).toEqual({ kind: 'repository', path: 'logo.svg' });
    expect(resolveImageAddress('docs/guide.md', '/images/cover.png')).toEqual({
      kind: 'repository',
      path: 'images/cover.png'
    });
    expect(resolveImageAddress('README.md', 'a.png')).toEqual({ kind: 'repository', path: 'a.png' });
  });

  it('AC-EDIT-003.5: decodes percent-encoding and drops the query', () => {
    expect(resolveImageAddress('docs/guide.md', 'my%20photo.png')).toEqual({
      kind: 'repository',
      path: 'docs/my photo.png'
    });
    expect(resolveImageAddress('docs/guide.md', 'img.png?v=2')).toEqual({ kind: 'repository', path: 'docs/img.png' });
    expect(resolveImageAddress('docs/guide.md', 'img.png#top')).toEqual({ kind: 'repository', path: 'docs/img.png' });
  });

  it('keeps the case of the path', () => {
    expect(resolveImageAddress('Docs/a.md', 'IMG/Flow.PNG')).toEqual({ kind: 'repository', path: 'Docs/IMG/Flow.PNG' });
  });

  it('refuses climbing above the root, also percent-encoded', () => {
    expect(resolveImageAddress('docs/a.md', '../../etc/passwd')).toEqual({ kind: 'refused' });
    expect(resolveImageAddress('docs/a.md', '../../../../etc/passwd')).toEqual({ kind: 'refused' });
    expect(resolveImageAddress('docs/a.md', '%2e%2e/%2e%2e/etc/a.png')).toEqual({ kind: 'refused' });
    expect(resolveImageAddress('docs/a.md', '..\\..\\etc\\a.png')).toEqual({ kind: 'refused' });
    expect(resolveImageAddress('docs/a.md', '/../a.png')).toEqual({ kind: 'refused' });
    expect(resolveImageAddress('docs/a.md', '..%2f..%2fa.png')).toEqual({ kind: 'refused' });
  });

  it('refuses .git in any case', () => {
    expect(resolveImageAddress('a.md', '.git/config')).toEqual({ kind: 'refused' });
    expect(resolveImageAddress('a.md', '.GIT/x.png')).toEqual({ kind: 'refused' });
    expect(resolveImageAddress('docs/a.md', '../.Git/objects/x.png')).toEqual({ kind: 'refused' });
    expect(resolveImageAddress('a.md', 'sub/.git/x.png')).toEqual({ kind: 'refused' });
  });

  it('refuses what cannot be decoded and empty addresses', () => {
    expect(resolveImageAddress('a.md', '%E0%A4%A.png')).toEqual({ kind: 'refused' });
    expect(resolveImageAddress('a.md', '')).toEqual({ kind: 'refused' });
    expect(resolveImageAddress('a.md', '?v=1')).toEqual({ kind: 'refused' });
    expect(resolveImageAddress('a.md', '/')).toEqual({ kind: 'refused' });
  });

  it('classifies https, protocol-relative and http', () => {
    expect(resolveImageAddress('a.md', 'https://img.shields.io/badge/x.svg')).toEqual({
      kind: 'remote',
      url: 'https://img.shields.io/badge/x.svg',
      host: 'img.shields.io'
    });
    expect(resolveImageAddress('a.md', '//cdn.example.com/a.png')).toEqual({
      kind: 'remote',
      url: 'https://cdn.example.com/a.png',
      host: 'cdn.example.com'
    });
    expect(resolveImageAddress('a.md', 'HTTPS://Example.com:8443/a')).toEqual({
      kind: 'remote',
      url: 'https://example.com:8443/a',
      host: 'example.com:8443'
    });
    expect(resolveImageAddress('a.md', 'http://example.com/a.png')).toEqual({ kind: 'insecure' });
    expect(resolveImageAddress('a.md', 'data:image/png;base64,AAAA')).toEqual({ kind: 'refused' });
    expect(resolveImageAddress('a.md', 'javascript:alert(1)')).toEqual({ kind: 'refused' });
  });

  it('marks unsupported extensions', () => {
    expect(resolveImageAddress('a.md', 'scan.tiff')).toEqual({ kind: 'unsupported' });
    expect(resolveImageAddress('a.md', 'photo.HEIC')).toEqual({ kind: 'unsupported' });
    expect(resolveImageAddress('a.md', 'Makefile')).toEqual({ kind: 'unsupported' });
    for (const name of [ 'a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.avif', 'a.jxl', 'a.svg' ]) {
      expect(resolveImageAddress('a.md', name)).toEqual({ kind: 'repository', path: name });
    }
  });

  it('refuses before it looks at the format', () => {
    expect(resolveImageAddress('a.md', '.git/config')).toEqual({ kind: 'refused' });
    expect(resolveImageAddress('a.md', '../a.tiff')).toEqual({ kind: 'refused' });
  });
});
