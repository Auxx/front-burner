import BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Database, openDatabase } from '../database/open-database';
import { backupsDirOf, DatabaseSnapshots, SNAPSHOT_PREFIX } from './database-snapshots';

const DAY = 86_400_000;
const START = new Date('2026-11-17T09:30:15.250Z');
const daysLater = (days: number) => new Date(START.getTime() + days * DAY);

/** A worker that inserts rows into `file` for `ms` milliseconds, then posts how many. */
const WRITER = `
const { parentPort, workerData } = require('node:worker_threads');
const Database = require('better-sqlite3');
const db = new Database(workerData.file);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
const insert = db.prepare('INSERT INTO notes (body) VALUES (?)');
const end = Date.now() + workerData.ms;
let count = 0;
parentPort.postMessage('started');
while (Date.now() < end) {
  db.transaction(() => {
    for (let i = 0; i < 20; i++) {
      insert.run('x'.repeat(200));
    }
  })();
  count += 20;
}
db.close();
parentPort.postMessage(count);
`;

describe('DatabaseSnapshots', () => {
  let root: string;
  let dir: string;
  let database: Database;
  let snapshots: DatabaseSnapshots;

  const files = () => readdirSync(dir).sort();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-snapshots-'));
    dir = backupsDirOf(root);
    mkdirSync(dir);
    database = openDatabase(join(root, 'front-burner.sqlite'));
    database.sqlite.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
    database.sqlite.prepare('INSERT INTO notes (body) VALUES (?)').run('first');
    snapshots = new DatabaseSnapshots(database.sqlite, dir, '1.4.2');
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps the backups in the data directory', () => {
    expect(backupsDirOf('/data')).toBe(join('/data', 'backups'));
  });

  it('writes a snapshot named with the time and version', () => {
    const file = snapshots.write(SNAPSHOT_PREFIX, START);

    expect(file).toBe(join(dir, 'front-burner-2026-11-17T09-30-15Z-v1.4.2.sqlite'));
    expect(files()).toEqual([ 'front-burner-2026-11-17T09-30-15Z-v1.4.2.sqlite' ]);
    const copy = new BetterSqlite3(file, { readonly: true });
    try {
      expect(copy.prepare('SELECT body FROM notes').pluck().all()).toEqual([ 'first' ]);
    } finally {
      copy.close();
    }
  });

  it('writes a version that is no safe file name as one that is', () => {
    const file = new DatabaseSnapshots(database.sqlite, dir, '../2.0 beta').write(SNAPSHOT_PREFIX, START);

    expect(file).toBe(join(dir, 'front-burner-2026-11-17T09-30-15Z-v.._2.0_beta.sqlite'));
  });

  it('a snapshot during writes opens and passes integrity_check', async () => {
    const worker = new Worker(WRITER, {
      eval: true,
      workerData: { file: join(root, 'front-burner.sqlite'), ms: 1500 }
    });
    const done = new Promise<number>((resolve, reject) => {
      worker.on('message', (message: unknown) => {
        if (typeof message === 'number') {
          resolve(message);
        }
      });
      worker.on('error', reject);
    });
    await new Promise<void>(resolve => worker.once('message', () => resolve()));

    const written: string[] = [];
    for (let i = 0; i < 5; i++) {
      written.push(snapshots.write(SNAPSHOT_PREFIX, daysLater(i)));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(await done).toBeGreaterThan(0);

    const counts = written.map(file => {
      const copy = new BetterSqlite3(file, { readonly: true });
      try {
        expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
        return copy.prepare('SELECT count(*) FROM notes').pluck().get() as number;
      } finally {
        copy.close();
      }
    });
    // Each snapshot holds whole transactions, and later ones more of them.
    expect(counts.every(count => (count - 1) % 20 === 0)).toBe(true);
    expect(counts).toEqual([ ...counts ].sort((a, b) => a - b));
    expect(counts.at(-1)).toBeGreaterThan(counts[0]);
  });

  it('a failed snapshot removes its partial file and prunes nothing', () => {
    for (let day = 0; day < 7; day++) {
      snapshots.write(SNAPSHOT_PREFIX, daysLater(day));
    }
    const before = files();
    const prepare = database.sqlite.prepare.bind(database.sqlite);
    vi.spyOn(database.sqlite, 'prepare').mockImplementation(sql => {
      if (sql.startsWith('VACUUM INTO')) {
        return {
          run: (path: string) => {
            writeFileSync(path, 'half a database');
            throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
          }
        } as unknown as BetterSqlite3.Statement;
      }
      return prepare(sql);
    });

    expect(() => snapshots.write(SNAPSHOT_PREFIX, daysLater(7))).toThrow('database or disk is full');

    expect(files()).toEqual(before);
  });

  it('replaces a partial file that a crash left', () => {
    const name = 'front-burner-2026-11-17T09-30-15Z-v1.4.2.sqlite';
    writeFileSync(join(dir, `${name}.partial`), 'half a database');

    snapshots.write(SNAPSHOT_PREFIX, START);

    expect(files()).toEqual([ name ]);
  });

  it('keeps the newest seven', () => {
    const written = Array.from({ length: 9 }, (_, day) => snapshots.write(SNAPSHOT_PREFIX, daysLater(day)));

    expect(snapshots.prune(SNAPSHOT_PREFIX, 7)).toEqual(written.slice(0, 2));

    expect(files()).toEqual(written.slice(2).map(file => file.slice(dir.length + 1)));
    expect(snapshots.prune(SNAPSHOT_PREFIX, 7)).toEqual([]);
  });

  it('prunes only its own snapshots', () => {
    const others = [
      'pre-upgrade-2026-11-01T00-00-00Z-v1.4.1.sqlite',
      'front-burner.sqlite',
      'front-burner-copy.sqlite',
      'my-backup.sqlite',
      'notes.txt'
    ];
    for (const name of others) {
      writeFileSync(join(dir, name), '');
    }
    mkdirSync(join(dir, 'front-burner-2026-01-01T00-00-00Z-v1.0.0.sqlite.d'));
    const stale = 'front-burner-2026-11-10T00-00-00Z-v1.4.1.sqlite.partial';
    writeFileSync(join(dir, stale), '');
    const written = [ 0, 1, 2 ].map(day => snapshots.write(SNAPSHOT_PREFIX, daysLater(day)));

    expect(snapshots.prune(SNAPSHOT_PREFIX, 1)).toEqual([ join(dir, stale), ...written.slice(0, 2) ]);

    expect(files()).toEqual([
      ...others,
      'front-burner-2026-01-01T00-00-00Z-v1.0.0.sqlite.d',
      written[2].slice(dir.length + 1)
    ].sort());
  });

  it('finds the newest snapshot by its name', () => {
    expect(snapshots.newest(SNAPSHOT_PREFIX)).toBeUndefined();
    writeFileSync(join(dir, 'pre-upgrade-2027-01-01T00-00-00Z-v1.4.1.sqlite'), '');
    writeFileSync(join(dir, 'front-burner-2027-01-01T00-00-00Z-v1.4.2.sqlite.partial'), '');
    expect(snapshots.newest(SNAPSHOT_PREFIX)).toBeUndefined();

    snapshots.write(SNAPSHOT_PREFIX, daysLater(2));
    snapshots.write(SNAPSHOT_PREFIX, daysLater(1));

    expect(snapshots.newest(SNAPSHOT_PREFIX)).toEqual(new Date('2026-11-19T09:30:15Z'));
    expect(snapshots.newest('pre-upgrade')).toEqual(new Date('2027-01-01T00:00:00Z'));
  });

  it('finds no snapshot in a missing folder', () => {
    rmSync(dir, { recursive: true });

    expect(snapshots.newest(SNAPSHOT_PREFIX)).toBeUndefined();
    expect(existsSync(dir)).toBe(false);
  });
});
