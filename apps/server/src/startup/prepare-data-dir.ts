import { DataLayout } from '@front-burner/server-core-storage';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Creates the data directory's layout (NF-5.1) and the repositories
 * directory's (NF-5.4), proves that their folders are writable (NF-5.6) and
 * empties `tmp/`, so that a half-finished clone never survives a restart
 * (NF-5.1).
 *
 * @param reposRoot `Config.reposRoot`: the data directory unless `FRONT_BURNER_REPOS_DIR` is set.
 * @throws Error naming the directory when it cannot be used.
 */
export function prepareDataDir(dataDir: string, reposRoot = dataDir): { databaseFile: string; } {
  const databaseDir = join(dataDir, 'db');
  const layout = new DataLayout(dataDir, reposRoot);
  const folders: [ string, string ][] = [
    [ databaseDir, 'data directory' ],
    ...[ layout.reposDir, layout.tmpDir, layout.orphansDir ].map((dir): [ string, string ] => [
      dir,
      reposRoot === dataDir ? 'data directory' : 'repositories directory'
    ])
  ];
  for (const [ dir, name ] of folders) {
    try {
      mkdirSync(dir, { recursive: true });
      const probe = join(dir, '.write-test');
      writeFileSync(probe, '');
      rmSync(probe);
    } catch (cause) {
      throw new Error(`The ${name} ${dir} is not writable`, { cause });
    }
  }
  for (const entry of readdirSync(layout.tmpDir)) {
    rmSync(join(layout.tmpDir, entry), { recursive: true, force: true });
  }
  return { databaseFile: join(databaseDir, 'front-burner.sqlite') };
}
