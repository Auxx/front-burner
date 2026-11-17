import { Database } from '@front-burner/server-core-database';
import { DATA_LAYOUT, DataLayout } from '@front-burner/server-core-storage';
import { Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstanceRepositories } from '../repositories/instance-repositories';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { OrphanedWorkingCopies } from './orphaned-working-copies';

describe('OrphanedWorkingCopies', () => {
  let root: string;
  let database: Database;
  let layout: DataLayout;
  let orphans: OrphanedWorkingCopies;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  /** A working copy with a file in it, as a clone leaves one. */
  const workingCopy = (userId: number, repositoryId: number): string => {
    const path = layout.workingCopy(userId, repositoryId);
    mkdirSync(join(path, '.git'), { recursive: true });
    writeFileSync(join(path, 'README.md'), 'unpushed work');
    return path;
  };
  const orphaned = (): string[] => readdirSync(layout.orphansDir).sort();
  const logged = (spy: ReturnType<typeof vi.spyOn>): string[] =>
    spy.mock.calls.map((call: unknown[]) => String(call.at(-1)));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ 'Date' ] });
    vi.setSystemTime(new Date('2026-11-16T10:00:00.123Z'));
    root = mkdtempSync(join(tmpdir(), 'fb-orphans-'));
    database = createTestDatabase();
    layout = new DataLayout(root);
    mkdirSync(layout.reposDir, { recursive: true });
    mkdirSync(layout.orphansDir, { recursive: true });
    orphans = new OrphanedWorkingCopies(new InstanceRepositories(database), layout);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('moves a working copy without a repository to orphans', () => {
    const alice = insertUser(database, 'alice@x.io');
    // A database restored from a snapshot older than repository 12.
    workingCopy(alice, 12);

    expect(orphans.moveAll()).toEqual([ `${alice}-12-2026-11-16T10-00-00Z` ]);

    expect(orphaned()).toEqual([ `${alice}-12-2026-11-16T10-00-00Z` ]);
    expect(existsSync(join(layout.orphansDir, `${alice}-12-2026-11-16T10-00-00Z`, 'README.md'))).toBe(true);
    expect(existsSync(layout.workingCopy(alice, 12))).toBe(false);
    expect(logged(warn)).toEqual([
      `Working copy of repository 12 (user ${alice}) has no repository; moved to orphans/${alice}-12-2026-11-16T10-00-00Z`
    ]);
  });

  it('leaves every repository\'s working copy', () => {
    const alice = insertUser(database, 'alice@x.io');
    const bob = insertUser(database, 'bob@x.io');
    const ready = insertRepository(database, alice, { name: 'ready' });
    const failed = insertRepository(database, alice, { name: 'failed', status: 'error', errorCode: 'clone-failed' });
    const notes = insertRepository(database, bob, { name: 'notes' });
    for (const [ userId, id ] of [ [ alice, ready ], [ alice, failed ], [ bob, notes ] ]) {
      workingCopy(userId, id);
    }

    expect(orphans.moveAll()).toEqual([]);

    expect(orphaned()).toEqual([]);
    expect(existsSync(layout.workingCopy(alice, ready))).toBe(true);
    expect(existsSync(layout.workingCopy(alice, failed))).toBe(true);
    expect(existsSync(layout.workingCopy(bob, notes))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a working copy under the wrong user is an orphan', () => {
    const alice = insertUser(database, 'alice@x.io');
    const bob = insertUser(database, 'bob@x.io');
    const handbook = insertRepository(database, alice, { name: 'handbook' });
    workingCopy(alice, handbook);
    workingCopy(bob, handbook);

    expect(orphans.moveAll()).toEqual([ `${bob}-${handbook}-2026-11-16T10-00-00Z` ]);

    expect(existsSync(layout.workingCopy(alice, handbook))).toBe(true);
  });

  it('two orphans of the same IDs keep both', () => {
    const alice = insertUser(database, 'alice@x.io');
    workingCopy(alice, 12);
    orphans.moveAll();
    workingCopy(alice, 12);

    expect(orphans.moveAll()).toEqual([ `${alice}-12-2026-11-16T10-00-00Z-2` ]);

    expect(orphaned()).toEqual([ `${alice}-12-2026-11-16T10-00-00Z`, `${alice}-12-2026-11-16T10-00-00Z-2` ]);
    for (const name of orphaned()) {
      expect(existsSync(join(layout.orphansDir, name, 'README.md'))).toBe(true);
    }
  });

  it('a folder whose name is not a number is left and logged', () => {
    const alice = insertUser(database, 'alice@x.io');
    mkdirSync(join(layout.reposDir, 'lost+found'));
    mkdirSync(join(layout.reposDir, String(alice), 'handbook'), { recursive: true });
    mkdirSync(join(layout.reposDir, String(alice), '012'), { recursive: true });

    expect(orphans.moveAll()).toEqual([]);

    expect(existsSync(join(layout.reposDir, 'lost+found'))).toBe(true);
    expect(existsSync(join(layout.reposDir, String(alice), 'handbook'))).toBe(true);
    expect(existsSync(join(layout.reposDir, String(alice), '012'))).toBe(true);
    expect(orphaned()).toEqual([]);
    // Never the name itself: it may be a repository's (NF-10.5).
    expect(logged(warn)).toEqual([
      `repos/${alice}/ holds an entry that the backend did not make; it is left where it is`,
      `repos/${alice}/ holds an entry that the backend did not make; it is left where it is`,
      'repos/ holds an entry that the backend did not make; it is left where it is'
    ]);
  });

  it('removes a user folder left empty', () => {
    const alice = insertUser(database, 'alice@x.io');
    const bob = insertUser(database, 'bob@x.io');
    const notes = insertRepository(database, bob, { name: 'notes' });
    workingCopy(alice, 12);
    workingCopy(bob, 13);
    workingCopy(bob, notes);

    expect(orphans.moveAll()).toHaveLength(2);

    expect(existsSync(join(layout.reposDir, String(alice)))).toBe(false);
    expect(readdirSync(join(layout.reposDir, String(bob)))).toEqual([ String(notes) ]);
  });

  it('a failed move is logged and the start goes on', () => {
    const alice = insertUser(database, 'alice@x.io');
    const bob = insertUser(database, 'bob@x.io');
    workingCopy(alice, 12);
    workingCopy(bob, 13);
    // Not a folder: no rename into it can work.
    rmSync(layout.orphansDir, { recursive: true });
    writeFileSync(layout.orphansDir, '');

    expect(orphans.moveAll()).toEqual([]);

    expect(existsSync(layout.workingCopy(alice, 12))).toBe(true);
    expect(existsSync(layout.workingCopy(bob, 13))).toBe(true);
    expect(logged(error)).toEqual([
      `Could not move the working copy of repository 12 (user ${alice}) to orphans/`,
      `Could not move the working copy of repository 13 (user ${bob}) to orphans/`
    ]);
  });

  it('does nothing without a repos folder', () => {
    rmSync(layout.reposDir, { recursive: true });

    expect(orphans.moveAll()).toEqual([]);
  });

  it('runs before working copy recovery', async () => {
    const alice = insertUser(database, 'alice@x.io');
    workingCopy(alice, 12);
    const seen: boolean[] = [];

    // As the sync feature's `WorkingCopyRecovery`, in a module that imports this one.
    @Injectable()
    class Recovery implements OnModuleInit {
      onModuleInit(): void {
        seen.push(existsSync(layout.workingCopy(alice, 12)));
      }
    }
    @Module({
      providers: [
        { provide: InstanceRepositories, useValue: new InstanceRepositories(database) },
        { provide: DATA_LAYOUT, useValue: layout },
        OrphanedWorkingCopies
      ],
      exports: [ InstanceRepositories ]
    })
    class Repositories {}
    @Module({ imports: [ Repositories ], providers: [ Recovery ] })
    class Sync {}

    const app = (await Test.createTestingModule({ imports: [ Sync ] }).compile()).createNestApplication();
    await app.init();
    await app.close();

    expect(seen).toEqual([ false ]);
    expect(orphaned()).toEqual([ `${alice}-12-2026-11-16T10-00-00Z` ]);
  });
});
