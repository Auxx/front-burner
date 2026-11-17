import type BetterSqlite3 from 'better-sqlite3';
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** The prefix of the daily snapshots (NF-6.2). */
export const SNAPSHOT_PREFIX = 'front-burner';

const PARTIAL = '.partial';
const STAMP = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `2026-11-17T09-30-15Z`: the UTC time to the second, with `:` written as `-`. */
function stampOf(time: Date): string {
  return time.toISOString().replace(/\.\d{3}Z$/, 'Z').replaceAll(':', '-');
}

/** The inverse of {@link stampOf}. */
function timeOf(stamp: string): Date {
  const [ date, time ] = stamp.split('T');
  return new Date(`${date}T${time.replaceAll('-', ':')}`);
}

/** Makes a rename or removal in the folder durable; a no-op where folders cannot be opened (Windows). */
function fsyncDir(dir: string): void {
  let fd: number;
  try {
    fd = openSync(dir, 'r');
  } catch {
    return;
  }
  try {
    fsyncSync(fd);
  } catch {
    // Some file systems refuse fsync on a folder; the rename still happened.
  } finally {
    closeSync(fd);
  }
}

interface Snapshot {
  name: string;
  time: Date;
}

/**
 * Consistent copies of the live database in `backups/` (NF-6.2, A-4.12),
 * named `<prefix>-<UTC time>-v<version>.sqlite`, so that names sort by time.
 * Each prefix is its own series: pruning one never touches another, nor any
 * file whose name is not one of its snapshots, such as the operator's own
 * copies.
 *
 * A snapshot whose time is after `now` was written while the clock was ahead,
 * so it is older than any snapshot written since: it counts as the oldest.
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
   * Creates the folder if it went away while the instance ran.
   *
   * @returns the snapshot's path.
   */
  write(prefix: string, now = new Date()): string {
    const version = this.version.replace(/[^\w.+-]/g, '_');
    const file = join(this.dir, `${prefix}-${stampOf(now)}-v${version}.sqlite`);
    const partial = `${file}${PARTIAL}`;
    mkdirSync(this.dir, { recursive: true });
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
      fsyncDir(this.dir);
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
  prune(prefix: string, keep: number, now = new Date()): string[] {
    const { snapshots, partials } = this.list(prefix, now);
    const removed = [
      ...partials,
      ...snapshots.slice(0, Math.max(0, snapshots.length - keep)).map(({ name }) => name)
    ].map(name => join(this.dir, name));
    for (const file of removed) {
      rmSync(file, { force: true });
    }
    if (removed.length > 0) {
      fsyncDir(this.dir);
    }
    return removed;
  }

  /**
   * The time of the newest snapshot of the prefix that is not after `now`,
   * from its name rather than the file's time, which a restore changes;
   * undefined when there is none.
   */
  newest(prefix: string, now = new Date()): Date | undefined {
    const newest = this.list(prefix, now).snapshots.at(-1);
    return newest === undefined || newest.time > now ? undefined : newest.time;
  }

  /**
   * The prefix's snapshots, oldest first, those after `now` before all others,
   * and its partial files; regular files only.
   */
  private list(prefix: string, now: Date): { snapshots: Snapshot[]; partials: string[]; } {
    let entries;
    try {
      entries = readdirSync(this.dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { snapshots: [], partials: [] };
      }
      throw error;
    }
    const pattern = new RegExp(`^${escapeRegExp(prefix)}-(${STAMP})-v[\\w.+-]+\\.sqlite(${escapeRegExp(PARTIAL)})?$`);
    const snapshots: Snapshot[] = [];
    const partials: string[] = [];
    for (const entry of entries) {
      const match = entry.isFile() ? pattern.exec(entry.name) : null;
      if (match === null) {
        continue;
      }
      if (match[2] === undefined) {
        snapshots.push({ name: entry.name, time: timeOf(match[1]) });
      } else {
        partials.push(entry.name);
      }
    }
    const future = (snapshot: Snapshot) => snapshot.time > now;
    const byName = (a: Snapshot, b: Snapshot) => a.name < b.name ? -1 : Number(a.name > b.name);
    snapshots.sort((a, b) => Number(future(b)) - Number(future(a)) || byName(a, b));
    return { snapshots, partials: partials.sort() };
  }
}
