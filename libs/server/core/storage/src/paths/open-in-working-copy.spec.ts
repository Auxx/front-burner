import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openInWorkingCopy } from './open-in-working-copy';
import { PathRefusedError, resolveInWorkingCopy } from './resolve-in-working-copy';

describe('openInWorkingCopy', () => {
  let base: string;
  let root: string;
  let outside: string;

  const refusal = (promise: Promise<unknown>) =>
    promise.then(() => undefined, (error: unknown) => error instanceof PathRefusedError ? error.reason : error);

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'fb-open-spec-'));
    root = join(base, 'work');
    outside = join(base, 'outside');
    mkdirSync(join(root, 'docs', 'deep'), { recursive: true });
    writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\n');
    mkdirSync(join(outside, 'deep'), { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), 'secret\n');
    writeFileSync(join(outside, 'deep', 'secret.txt'), 'secret\n');
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('reads a folder and a file through the descriptor', async () => {
    const folder = await openInWorkingCopy(root, await resolveInWorkingCopy(root, 'docs'));
    const file = await openInWorkingCopy(root, await resolveInWorkingCopy(root, 'docs/guide.md'));
    try {
      expect((await readdir(folder.path)).sort()).toEqual([ 'deep', 'guide.md' ]);
      expect(await file.handle.readFile('utf8')).toBe('# Guide\n');
    } finally {
      await folder.handle.close();
      await file.handle.close();
    }
  });

  it('opens the root', async () => {
    const folder = await openInWorkingCopy(root, await resolveInWorkingCopy(root, ''));
    try {
      expect(await readdir(folder.path)).toEqual([ 'docs' ]);
    } finally {
      await folder.handle.close();
    }
  });

  it('refuses a folder swapped for a link between resolving and reading', async () => {
    const resolved = await resolveInWorkingCopy(root, 'docs');
    rmSync(join(root, 'docs'), { recursive: true });
    symlinkSync(outside, join(root, 'docs'));

    expect(await refusal(openInWorkingCopy(root, resolved))).toBe('symlink');
  });

  it('refuses a parent folder swapped for a link between resolving and reading', async () => {
    const resolved = await resolveInWorkingCopy(root, 'docs/deep');
    rmSync(join(root, 'docs'), { recursive: true });
    symlinkSync(outside, join(root, 'docs'));

    expect(await refusal(openInWorkingCopy(root, resolved))).toBe('symlink');
  });

  it('refuses a file swapped for a link between resolving and reading', async () => {
    const resolved = await resolveInWorkingCopy(root, 'docs/guide.md');
    rmSync(join(root, 'docs', 'guide.md'));
    symlinkSync(join(outside, 'secret.txt'), join(root, 'docs', 'guide.md'));

    expect(await refusal(openInWorkingCopy(root, resolved))).toBe('symlink');
  });

  it('keeps reading the opened folder after it is swapped', async () => {
    const folder = await openInWorkingCopy(root, await resolveInWorkingCopy(root, 'docs'));
    try {
      renameSync(join(root, 'docs'), join(root, 'old'));
      symlinkSync(outside, join(root, 'docs'));

      // The real path is checked once, at open; the descriptor still names the original folder.
      expect((await readdir(folder.path)).sort()).toEqual([ 'deep', 'guide.md' ]);
      expect(await readFile(join(folder.path, 'guide.md'), 'utf8')).toBe('# Guide\n');
    } finally {
      await folder.handle.close();
    }
  });

  it('refuses an entry that is gone or changed kind', async () => {
    const resolved = await resolveInWorkingCopy(root, 'docs');
    rmSync(join(root, 'docs'), { recursive: true });
    expect(await refusal(openInWorkingCopy(root, resolved))).toBe('not-found');

    writeFileSync(join(root, 'docs'), 'now a file\n');
    expect(await refusal(openInWorkingCopy(root, resolved))).toBe('not-found');
  });

  it('refuses a file replaced by a FIFO without blocking', async () => {
    const resolved = await resolveInWorkingCopy(root, 'docs/guide.md');
    rmSync(join(root, 'docs', 'guide.md'));
    execFileSync('mkfifo', [ join(root, 'docs', 'guide.md') ]);

    expect(await refusal(openInWorkingCopy(root, resolved))).toBe('not-found');
  });

  it('accepts a working copy whose own path goes through a link', async () => {
    symlinkSync(root, join(base, 'alias'));
    const alias = join(base, 'alias');
    const folder = await openInWorkingCopy(alias, await resolveInWorkingCopy(alias, 'docs'));
    await folder.handle.close();
  });
});
