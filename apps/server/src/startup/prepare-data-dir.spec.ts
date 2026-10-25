import { chmodSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
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
    expect(existsSync(join(dataDir, '.write-test'))).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)('throws naming the path when the directory is not writable', () => {
    chmodSync(root, 0o500);
    const dataDir = join(root, 'data');

    expect(() => prepareDataDir(dataDir)).toThrow(dataDir);
  });
});
