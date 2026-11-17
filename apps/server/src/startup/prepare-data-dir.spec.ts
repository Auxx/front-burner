import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareDataDir } from './prepare-data-dir';

describe('prepareDataDir', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-data-'));
  });

  afterEach(() => {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  });

  it('creates db/ and returns the database file', () => {
    const dataDir = join(root, 'data');

    const { databaseFile } = prepareDataDir(dataDir);

    expect(databaseFile).toBe(join(dataDir, 'db', 'front-burner.sqlite'));
    expect(existsSync(join(dataDir, 'db'))).toBe(true);
    expect(existsSync(join(dataDir, 'db', '.write-test'))).toBe(false);
  });

  it('creates repos, tmp and orphans', () => {
    const dataDir = join(root, 'data');

    prepareDataDir(dataDir);

    expect(readdirSync(dataDir).sort()).toEqual([ 'db', 'orphans', 'repos', 'tmp' ]);
  });

  it('creates orphans', () => {
    const dataDir = join(root, 'data');
    const reposRoot = join(root, 'slow');

    prepareDataDir(dataDir, reposRoot);

    expect(existsSync(join(reposRoot, 'orphans'))).toBe(true);
    expect(existsSync(join(reposRoot, 'orphans', '.write-test'))).toBe(false);
  });

  it('puts repos, tmp and orphans under the repositories directory', () => {
    const dataDir = join(root, 'data');
    const reposRoot = join(root, 'slow');

    const { databaseFile } = prepareDataDir(dataDir, reposRoot);

    expect(databaseFile).toBe(join(dataDir, 'db', 'front-burner.sqlite'));
    expect(readdirSync(dataDir)).toEqual([ 'db' ]);
    expect(readdirSync(reposRoot).sort()).toEqual([ 'orphans', 'repos', 'tmp' ]);
  });

  it('empties tmp under the repositories root on start', () => {
    const dataDir = join(root, 'data');
    const reposRoot = join(root, 'slow');
    mkdirSync(join(reposRoot, 'tmp', 'clone-1', '.git'), { recursive: true });
    mkdirSync(join(reposRoot, 'repos', '1', '2'), { recursive: true });
    writeFileSync(join(reposRoot, 'repos', '1', '2', 'README.md'), '# Hi');

    prepareDataDir(dataDir, reposRoot);

    expect(readdirSync(join(reposRoot, 'tmp'))).toEqual([]);
    expect(readdirSync(join(reposRoot, 'repos', '1', '2'))).toEqual([ 'README.md' ]);
  });

  it('the data directory as the repositories directory is the default layout', () => {
    const dataDir = join(root, 'data');

    prepareDataDir(dataDir, dataDir);

    expect(readdirSync(dataDir).sort()).toEqual([ 'db', 'orphans', 'repos', 'tmp' ]);
  });

  it('empties tmp on start', () => {
    const dataDir = join(root, 'data');
    mkdirSync(join(dataDir, 'tmp', 'clone-1', '.git'), { recursive: true });
    writeFileSync(join(dataDir, 'tmp', 'left-over'), '');
    mkdirSync(join(dataDir, 'repos', '1', '2'), { recursive: true });
    writeFileSync(join(dataDir, 'repos', '1', '2', 'README.md'), '# Hi');

    prepareDataDir(dataDir);

    expect(readdirSync(join(dataDir, 'tmp'))).toEqual([]);
    expect(readdirSync(join(dataDir, 'repos', '1', '2'))).toEqual([ 'README.md' ]);
  });

  it('a leftover removed working copy is deleted on start', () => {
    // A restart between Remove repository's move and its job (RM-19, NF-5.1).
    const dataDir = join(root, 'data');
    const removed = join(dataDir, 'tmp', 'remove-2-0b6f4f3c-6d1e-4f7a-9c2b-1d2e3f4a5b6c');
    mkdirSync(join(removed, '.git'), { recursive: true });
    writeFileSync(join(removed, 'README.md'), '# Hi');

    prepareDataDir(dataDir);

    expect(readdirSync(join(dataDir, 'tmp'))).toEqual([]);
  });

  // Mode bits do not make a folder unwritable on Windows, nor for root.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'throws naming the path when the directory is not writable',
    () => {
      chmodSync(root, 0o500);
      const dataDir = join(root, 'data');

      expect(() => prepareDataDir(dataDir)).toThrow(dataDir);
    }
  );

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'throws naming the repositories directory when it is not writable',
    () => {
      const dataDir = join(root, 'data');
      const reposRoot = join(root, 'slow');
      mkdirSync(reposRoot);
      chmodSync(reposRoot, 0o500);

      try {
        expect(() => prepareDataDir(dataDir, reposRoot)).toThrow(
          `The repositories directory ${join(reposRoot, 'repos')} is not writable`
        );
      } finally {
        chmodSync(reposRoot, 0o700);
      }
    }
  );
});
