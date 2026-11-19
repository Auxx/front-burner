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

  it('creates backups, repos, tmp and orphans', () => {
    const dataDir = join(root, 'data');

    prepareDataDir(dataDir);

    expect(readdirSync(dataDir).sort()).toEqual([ 'backups', 'db', 'orphans', 'repos', 'tmp' ]);
    expect(readdirSync(join(dataDir, 'backups'))).toEqual([]);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'throws naming backups when it is not writable',
    () => {
      const dataDir = join(root, 'data');
      mkdirSync(join(dataDir, 'backups'), { recursive: true });
      chmodSync(join(dataDir, 'backups'), 0o500);

      try {
        expect(() => prepareDataDir(dataDir)).toThrow(
          `The data directory ${join(dataDir, 'backups')} is not writable`
        );
      } finally {
        chmodSync(join(dataDir, 'backups'), 0o700);
      }
    }
  );

  it('puts repos, tmp and orphans under the repositories directory', () => {
    const dataDir = join(root, 'data');
    const reposRoot = join(root, 'slow');
    mkdirSync(reposRoot);

    const { databaseFile, backupsDir, warnings } = prepareDataDir(dataDir, reposRoot);

    expect(databaseFile).toBe(join(dataDir, 'db', 'front-burner.sqlite'));
    // In the data directory, never the repositories directory (A-4.12).
    expect(backupsDir).toBe(join(dataDir, 'backups'));
    expect(readdirSync(dataDir).sort()).toEqual([ 'backups', 'db' ]);
    expect(readdirSync(reposRoot).sort()).toEqual([ 'orphans', 'repos', 'tmp' ]);
    expect(readdirSync(join(reposRoot, 'orphans'))).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('throws when the repositories directory does not exist', () => {
    const dataDir = join(root, 'data');
    const reposRoot = join(root, 'unmounted');

    expect(() => prepareDataDir(dataDir, reposRoot)).toThrow(
      `The repositories directory ${reposRoot} does not exist`
    );
    expect(existsSync(reposRoot)).toBe(false);
  });

  it('throws when the repositories directory holds anything else, and empties nothing', () => {
    const dataDir = join(root, 'data');
    const reposRoot = join(root, 'shared');
    mkdirSync(join(reposRoot, 'tmp'), { recursive: true });
    writeFileSync(join(reposRoot, 'tmp', 'keep-me'), '');
    mkdirSync(join(reposRoot, 'photos'));

    expect(() => prepareDataDir(dataDir, reposRoot)).toThrow(
      `The repositories directory ${reposRoot} holds photos; it may hold only repos, tmp and orphans`
    );
    expect(readdirSync(join(reposRoot, 'tmp'))).toEqual([ 'keep-me' ]);
  });

  it('accepts the lost+found of a fresh volume', () => {
    const dataDir = join(root, 'data');
    const reposRoot = join(root, 'slow');
    mkdirSync(join(reposRoot, 'lost+found'), { recursive: true });

    expect(() => prepareDataDir(dataDir, reposRoot)).not.toThrow();
  });

  it('warns when the data directory still holds working copies', () => {
    const dataDir = join(root, 'data');
    const reposRoot = join(root, 'slow');
    mkdirSync(reposRoot);
    mkdirSync(join(dataDir, 'repos', '1', '2'), { recursive: true });

    const { warnings } = prepareDataDir(dataDir, reposRoot);

    expect(warnings).toEqual([
      `${join(dataDir, 'repos')} still holds working copies, but FRONT_BURNER_REPOS_DIR keeps them in `
      + `${join(reposRoot, 'repos')}, so their repositories show as missing. Stop the instance and move them there.`
    ]);
    expect(readdirSync(join(dataDir, 'repos'))).toEqual([ '1' ]);
  });

  it('does not warn about an empty repos folder left in the data directory', () => {
    const dataDir = join(root, 'data');
    const reposRoot = join(root, 'slow');
    mkdirSync(reposRoot);
    mkdirSync(join(dataDir, 'repos'), { recursive: true });

    expect(prepareDataDir(dataDir, reposRoot).warnings).toEqual([]);
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

    expect(readdirSync(dataDir).sort()).toEqual([ 'backups', 'db', 'orphans', 'repos', 'tmp' ]);
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

  // NF-5.6: the operator gives the volume to the UID the backend runs as.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'names the UID that needs to write',
    () => {
      chmodSync(root, 0o500);
      const dataDir = join(root, 'data');

      expect(() => prepareDataDir(dataDir)).toThrow(`is not writable by UID ${process.getuid?.()}`);
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
