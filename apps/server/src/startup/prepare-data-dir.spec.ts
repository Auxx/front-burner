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

  it('creates repos and tmp', () => {
    const dataDir = join(root, 'data');

    prepareDataDir(dataDir);

    expect(existsSync(join(dataDir, 'repos'))).toBe(true);
    expect(existsSync(join(dataDir, 'tmp'))).toBe(true);
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

  it.skipIf(process.getuid?.() === 0)('throws naming the path when the directory is not writable', () => {
    chmodSync(root, 0o500);
    const dataDir = join(root, 'data');

    expect(() => prepareDataDir(dataDir)).toThrow(dataDir);
  });
});
