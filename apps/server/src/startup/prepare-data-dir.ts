import { backupsDirOf } from '@front-burner/server-core-database';
import { DataLayout } from '@front-burner/server-core-storage';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What a separate repositories directory may hold: its three folders, and the
 * `lost+found` that a freshly made ext file system has.
 */
const REPOSITORIES_DIRECTORY_ENTRIES = new Set([ 'repos', 'tmp', 'orphans', 'lost+found' ]);

/**
 * Creates the data directory's layout (NF-5.1) and the repositories
 * directory's (NF-5.4), proves that their folders are writable (NF-5.6) and
 * empties `tmp/`, so that a half-finished clone never survives a restart
 * (NF-5.1).
 *
 * A separate repositories directory must already exist, as a volume that
 * failed to mount must not quietly become a folder of the container, and may
 * hold nothing but its own folders, as `tmp/` is emptied on every start.
 *
 * @param reposRoot `Config.reposRoot`: the data directory unless `FRONT_BURNER_REPOS_DIR` is set.
 * @returns the database file, and warnings for the operator.
 * @throws Error naming the directory when it cannot be used.
 */
export function prepareDataDir(
  dataDir: string,
  reposRoot = dataDir
): { databaseFile: string; warnings: string[]; } {
  const separate = reposRoot !== dataDir;
  if (separate) {
    checkRepositoriesDirectory(reposRoot);
  }
  const databaseDir = join(dataDir, 'db');
  const layout = new DataLayout(dataDir, reposRoot);
  const name = separate ? 'repositories directory' : 'data directory';
  const folders: [ string, string ][] = [
    [ databaseDir, 'data directory' ],
    [ backupsDirOf(dataDir), 'data directory' ],
    [ layout.reposDir, name ],
    [ layout.tmpDir, name ],
    [ layout.orphansDir, name ]
  ];
  for (const [ dir, folderOf ] of folders) {
    try {
      mkdirSync(dir, { recursive: true });
      const probe = join(dir, '.write-test');
      writeFileSync(probe, '');
      rmSync(probe);
    } catch (cause) {
      throw new Error(`The ${folderOf} ${dir} is not writable`, { cause });
    }
  }
  for (const entry of readdirSync(layout.tmpDir)) {
    rmSync(join(layout.tmpDir, entry), { recursive: true, force: true });
  }
  return {
    databaseFile: join(databaseDir, 'front-burner.sqlite'),
    warnings: separate ? leftBehind(new DataLayout(dataDir).reposDir, layout.reposDir) : []
  };
}

/** @throws Error when the directory is missing or holds anything but its own folders. */
function checkRepositoriesDirectory(reposRoot: string): void {
  let entries: string[];
  try {
    if (!statSync(reposRoot).isDirectory()) {
      throw new Error('not a directory');
    }
    entries = readdirSync(reposRoot);
  } catch (cause) {
    throw new Error(
      `The repositories directory ${reposRoot} does not exist; create it or mount its volume there`,
      { cause }
    );
  }
  const foreign = entries.filter(entry => !REPOSITORIES_DIRECTORY_ENTRIES.has(entry)).sort();
  if (foreign.length > 0) {
    throw new Error(
      `The repositories directory ${reposRoot} holds ${foreign.join(', ')}; it may hold only repos, tmp and `
        + 'orphans, as tmp is emptied on every start. Use an empty directory'
    );
  }
}

/** A warning when the data directory still holds working copies that the repositories directory now replaces. */
function leftBehind(oldReposDir: string, reposDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(oldReposDir);
  } catch {
    return [];
  }
  if (entries.length === 0) {
    return [];
  }
  return [
    `${oldReposDir} still holds working copies, but FRONT_BURNER_REPOS_DIR keeps them in ${reposDir}, `
    + 'so their repositories show as missing. Stop the instance and move them there.'
  ];
}
