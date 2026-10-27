import {
  applyMigrations,
  Database,
  EncryptedColumn,
  instanceState,
  openDatabase
} from '@front-burner/server-core-database';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretBox } from '../secret-box/secret-box';
import { checkEncryptionKey, EncryptionKeyMismatchError } from './check-encryption-key';

const MIGRATIONS = join(__dirname, '..', '..', '..', 'database', 'migrations');
const KEY = 'check-spec-encryption-key-0123456789abcdefghij';
const OTHER_KEY = 'another-check-spec-encryption-key-0123456789ab';

// A stand-in for a table with an encrypted column, registered only in these tests.
const vault = sqliteTable('test_vault', {
  id: integer('id').primaryKey(),
  secret: text('secret')
});
const COLUMNS: readonly EncryptedColumn[] = [ { table: vault, column: vault.secret } ];

describe('checkEncryptionKey', () => {
  let dir: string;
  let database: Database;

  const check = (key: string, reset = false) => checkEncryptionKey(database, new SecretBox(key), { reset }, COLUMNS);
  const secrets = () => database.db.select().from(vault).all().map(row => row.secret);
  const checkValue = () => database.db.select().from(instanceState).get()?.encryptionCheck;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fb-check-'));
    database = openDatabase(join(dir, 'test.db'));
    applyMigrations(database, MIGRATIONS);
    database.sqlite.exec('CREATE TABLE test_vault (id INTEGER PRIMARY KEY, secret TEXT)');
    const box = new SecretBox(KEY);
    database.db.insert(vault).values({ id: 1, secret: box.encrypt('token', { table: 'test_vault', recordId: 1 }) })
      .run();
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores a check value on first start', () => {
    expect(check(KEY)).toBe('stored');
    expect(checkValue()).toMatch(/^fb1\./);
    expect(database.db.select().from(instanceState).get()?.onboardingState).toBe('required');
  });

  it('keeps the onboarding state of an existing row', () => {
    database.db.insert(instanceState).values({ id: 1, onboardingState: 'completed' }).run();
    expect(check(KEY)).toBe('stored');
    expect(database.db.select().from(instanceState).get()?.onboardingState).toBe('completed');
  });

  it('verifies the same key', () => {
    check(KEY);
    const stored = checkValue();
    expect(check(KEY)).toBe('verified');
    expect(checkValue()).toBe(stored);
  });

  it('refuses the wrong key and leaves the values alone', () => {
    check(KEY);
    const stored = checkValue();
    const before = secrets();

    let error: unknown;
    try {
      check(OTHER_KEY);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(EncryptionKeyMismatchError);
    expect((error as Error).message).toContain('FRONT_BURNER_ENCRYPTION_KEY');
    expect((error as Error).message).not.toContain(KEY);
    expect((error as Error).message).not.toContain(OTHER_KEY);
    expect(secrets()).toEqual(before);
    expect(checkValue()).toBe(stored);
  });

  it('resets with the wrong key and confirm', () => {
    check(KEY);

    expect(check(OTHER_KEY, true)).toBe('reset');

    expect(secrets()).toEqual([ null ]);
    expect(check(OTHER_KEY)).toBe('verified');
  });

  it('ignores a reset when the key matches', () => {
    check(KEY);
    const before = secrets();

    expect(check(KEY, true)).toBe('verified');

    expect(secrets()).toEqual(before);
  });
});
