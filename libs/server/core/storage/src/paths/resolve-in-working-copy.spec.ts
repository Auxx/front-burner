import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PathRefusedError, resolveInWorkingCopy } from './resolve-in-working-copy';

describe('resolveInWorkingCopy', () => {
  let root: string;

  const refusal = (path: string, options?: Parameters<typeof resolveInWorkingCopy>[2]) =>
    resolveInWorkingCopy(root, path, options).then(
      () => undefined,
      (error: unknown) => error instanceof PathRefusedError ? error.reason : error
    );

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-paths-spec-'));
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\n');
    writeFileSync(join(root, 'README.md'), '# Readme\n');
    symlinkSync('/etc', join(root, 'link-out'));
    symlinkSync('../README.md', join(root, 'docs', 'link.md'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves the root and a nested file', async () => {
    expect(await resolveInWorkingCopy(root, '')).toEqual({ relative: '', absolute: root, type: 'folder' });
    expect(await resolveInWorkingCopy(root, 'docs')).toEqual(
      { relative: 'docs', absolute: join(root, 'docs'), type: 'folder' }
    );
    expect(await resolveInWorkingCopy(root, 'docs/guide.md')).toEqual(
      { relative: 'docs/guide.md', absolute: join(root, 'docs', 'guide.md'), type: 'file' }
    );
  });

  it('refuses malformed paths', async () => {
    for (const path of [ '/a', 'a/', 'a//b', './a', 'a/./b', 'a/../../x', '..', 'a\u0000', '/', '/etc/passwd' ]) {
      expect({ path, reason: await refusal(path) }).toEqual({ path, reason: 'malformed' });
    }
  });

  it('refuses .git in any case and position', async () => {
    for (const path of [ '.git', '.git/config', 'sub/.GIT/hooks', '.Git' ]) {
      expect({ path, reason: await refusal(path, { mayBeMissing: true }) }).toEqual({ path, reason: 'inside-git' });
    }
  });

  it('refuses a path through a symbolic link folder', async () => {
    expect(await refusal('link-out/passwd')).toBe('symlink');
    expect(await refusal('link-out/passwd', { mayBeMissing: true, symlinkLeaf: true })).toBe('symlink');
  });

  it('refuses a symbolic link leaf unless asked', async () => {
    expect(await refusal('docs/link.md')).toBe('symlink');
    expect(await resolveInWorkingCopy(root, 'docs/link.md', { symlinkLeaf: true })).toEqual(
      { relative: 'docs/link.md', absolute: join(root, 'docs', 'link.md'), type: 'symlink' }
    );
  });

  it('reports a missing leaf only when allowed', async () => {
    expect(await refusal('docs/new.md')).toBe('not-found');
    expect(await resolveInWorkingCopy(root, 'docs/new.md', { mayBeMissing: true })).toEqual(
      { relative: 'docs/new.md', absolute: join(root, 'docs', 'new.md'), type: 'missing' }
    );
  });

  it('refuses a missing parent even when the leaf may be missing', async () => {
    expect(await refusal('nope/new.md', { mayBeMissing: true })).toBe('not-found');
    expect(await refusal('README.md/new.md', { mayBeMissing: true })).toBe('not-found');
  });
});
