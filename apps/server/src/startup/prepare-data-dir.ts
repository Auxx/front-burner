import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Creates the data directory's layout (NF-5.1) and proves that the directory
 * is writable (NF-5.6).
 *
 * @throws Error naming the directory when it cannot be used.
 */
export function prepareDataDir(dataDir: string): { databaseFile: string; } {
  const databaseDir = join(dataDir, 'db');
  try {
    mkdirSync(databaseDir, { recursive: true });
    const probe = join(dataDir, '.write-test');
    writeFileSync(probe, '');
    rmSync(probe);
  } catch (cause) {
    throw new Error(`The data directory ${dataDir} is not writable`, { cause });
  }
  return { databaseFile: join(databaseDir, 'front-burner.sqlite') };
}
