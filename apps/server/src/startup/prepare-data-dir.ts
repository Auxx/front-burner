import { DataLayout } from '@front-burner/server-core-storage';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Creates the data directory's layout (NF-5.1), proves that its folders are
 * writable (NF-5.6) and empties `tmp/`, so that a half-finished clone never
 * survives a restart (NF-5.1).
 *
 * @throws Error naming the directory when it cannot be used.
 */
export function prepareDataDir(dataDir: string): { databaseFile: string; } {
  const databaseDir = join(dataDir, 'db');
  const layout = new DataLayout(dataDir);
  for (const dir of [ databaseDir, layout.reposDir, layout.tmpDir ]) {
    try {
      mkdirSync(dir, { recursive: true });
      const probe = join(dir, '.write-test');
      writeFileSync(probe, '');
      rmSync(probe);
    } catch (cause) {
      throw new Error(`The data directory ${dir} is not writable`, { cause });
    }
  }
  for (const entry of readdirSync(layout.tmpDir)) {
    rmSync(join(layout.tmpDir, entry), { recursive: true, force: true });
  }
  return { databaseFile: join(databaseDir, 'front-burner.sqlite') };
}
