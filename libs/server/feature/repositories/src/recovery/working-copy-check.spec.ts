import { Database, repositories } from '@front-burner/server-core-database';
import { DataLayout } from '@front-burner/server-core-storage';
import { asc } from 'drizzle-orm';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insertRepository, insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { WorkingCopyCheck } from './working-copy-check';

describe('WorkingCopyCheck', () => {
  let root: string;
  let database: Database;
  let layout: DataLayout;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fb-working-copy-check-'));
    database = createTestDatabase();
    layout = new DataLayout(root);
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('marks a missing working copy', () => {
    const alice = insertUser(database, 'alice@x.io');
    const present = insertRepository(database, alice, { name: 'present' });
    const missing = insertRepository(database, alice, { name: 'missing' });
    const cloning = insertRepository(database, alice, { name: 'cloning', status: 'cloning' });
    mkdirSync(join(layout.workingCopy(alice, present), '.git'), { recursive: true });
    mkdirSync(layout.workingCopy(alice, missing), { recursive: true });

    new WorkingCopyCheck(database, layout).onApplicationBootstrap();

    expect(
      database.db.select({ id: repositories.id, status: repositories.status, errorCode: repositories.errorCode })
        .from(repositories).orderBy(asc(repositories.id)).all()
    ).toEqual([
      { id: present, status: 'ready', errorCode: null },
      { id: missing, status: 'error', errorCode: 'working-copy-missing' },
      { id: cloning, status: 'cloning', errorCode: null }
    ]);
  });
});
