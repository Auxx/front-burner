import type BetterSqlite3 from 'better-sqlite3';
import { closeSync, fsyncSync, openSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** The prefix of the daily snapshots (NF-6.2). */
export const SNAPSHOT_PREFIX = 'front-burner';

const PARTIAL = '.partial';

/** `<data dir>/backups`: the database snapshots, in the data directory, never the repositories directory (NF-5.1). */
export function backupsDirOf(dataDir: string): string {
  return join(dataDir, 'backups');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `2026-11-17T09-30-15Z`: the UTC time to the second, with `:` written as `-`. */
function stampOf(time: Date): string {
  return time.toISOString().replace(/\.\d{3}Z$/, 'Z').replaceAll(':', '-');
}

/**
 * Consistent copies of the live database in `backups/` (NF-6.2, A-4.12),
 * named `<prefix>-<UTC time>-v<version>.sqlite`, so that names sort by time.
 * Each prefix is its own series: pruning one never touches another, nor any
 * file whose name is not one of its snapshots, such as the operator's own
 * copies.
 */
export class DatabaseSnapshots {
  constructor(
    private readonly sqlite: BetterSqlite3.Database,
    readonly dir: string,
    private readonly version: string
  ) {}

  /**
   * Writes a snapshot with `VACUUM INTO` to a `.partial` file, then renames
   * it into place, so that a half-written snapshot never looks like a good
   * one. A failure removes the partial file and changes no other snapshot.
   *
   * @returns the snapshot's path.
   */
  write(prefix: string, now = new Date()): string {
    const version = this.version.replace(/[^\w.+-]/g, '_');
    const file = join(this.dir, `${prefix}-${stampOf(now)}-v${version}.sqlite`);
    const partial = `${file}${PARTIAL}`;
    // VACUUM INTO refuses a file that is not empty, such as one a crash left.
    rmSync(partial, { force: true });
    try {
      this.sqlite.prepare('VACUUM INTO ?').run(partial);
      const fd = openSync(partial, 'r+');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(partial, file);
    } catch (error) {
      rmSync(partial, { force: true });
      throw error;
    }
    return file;
  }

  /**
   * Removes all but the newest `keep` snapshots of the prefix, and partial
   * files of the prefix that a crash left.
   *
   * @returns the paths of the removed files.
   */
  prune(prefix: string, keep: number): string[] {
    const { snapshots, partials } = this.list(prefix);
    const removed = [ ...partials, ...snapshots.slice(0, Math.max(0, snapshots.length - keep)) ]
      .map(name => join(this.dir, name));
    for (const file of removed) {
      rmSync(file, { force: true });
    }
    return removed;
  }

  /**
   * The time of the newest snapshot of the prefix, from its name rather than
   * the file's time, which a restore changes; undefined when there is none.
   */
  newest(prefix: string): Date | undefined {
    const name = this.list(prefix).snapshots.at(-1);
    const stamp = name === undefined ? undefined : this.pattern(prefix).exec(name)?.[1];
    if (stamp === undefined) {
      return undefined;
    }
    const [ date, time ] = stamp.split('T');
    return new Date(`${date}T${time.slice(0, -1).replaceAll('-', ':')}Z`);
  }

  /** The prefix's snapshots, oldest first, and its partial files; regular files only. */
  private list(prefix: string): { snapshots: string[]; partials: string[]; } {
    let entries;
    try {
      entries = readdirSync(this.dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { snapshots: [], partials: [] };
      }
      throw error;
    }
    const pattern = this.pattern(prefix);
    const snapshots: string[] = [];
    const partials: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      if (pattern.test(entry.name)) {
        snapshots.push(entry.name);
      } else if (entry.name.endsWith(PARTIAL) && pattern.test(entry.name.slice(0, -PARTIAL.length))) {
        partials.push(entry.name);
      }
    }
    return { snapshots: snapshots.sort(), partials: partials.sort() };
  }

  private pattern(prefix: string): RegExp {
    return new RegExp(`^${escapeRegExp(prefix)}-(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}Z)-v[\\w.+-]+\\.sqlite$`);
  }
}
