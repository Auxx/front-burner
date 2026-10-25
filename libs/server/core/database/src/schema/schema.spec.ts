import { ONBOARDING_STATES } from '@front-burner/shared-contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../database/migrations';
import { Database, openDatabase } from '../database/open-database';
import { instanceState, ONBOARDING_STATE_VALUES, users } from './index';

const migrationsFolder = join(__dirname, '..', '..', 'migrations');

const alice = {
  email: 'Alice@x.io',
  displayName: 'Alice',
  role: 'administrator',
  loginMethod: 'password',
  passwordHash: '$argon2id$hash',
  createdAt: new Date(0)
} as const;

describe('schema', () => {
  let dir: string;
  let database: Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fb-schema-'));
    database = openDatabase(join(dir, 'test.db'));
    applyMigrations(database, migrationsFolder);
  });

  afterEach(() => {
    database.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates both tables', () => {
    database.db.insert(users).values(alice).run();
    database.db.insert(instanceState).values({ id: 1, onboardingState: 'completed' }).run();

    expect(database.db.select().from(users).all()).toEqual([ { id: 1, ...alice } ]);
    expect(database.db.select().from(instanceState).all()).toEqual([ { id: 1, onboardingState: 'completed' } ]);
  });

  it('allows a user without a password hash', () => {
    database.db.insert(users).values({ ...alice, loginMethod: 'oidc', passwordHash: null }).run();
    expect(database.db.select().from(users).all()[0]?.passwordHash).toBeNull();
  });

  it('refuses a second user whose email differs only in case', () => {
    database.db.insert(users).values(alice).run();
    expect(() => database.db.insert(users).values({ ...alice, email: 'alice@X.io' }).run()).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' })
    );
  });

  it('allows only one instance_state row', () => {
    expect(() => database.db.insert(instanceState).values({ id: 2, onboardingState: 'required' }).run()).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' })
    );
  });
});

describe('ONBOARDING_STATE_VALUES', () => {
  it('lists the states of the contracts', () => {
    expect(ONBOARDING_STATE_VALUES).toEqual(ONBOARDING_STATES);
  });
});
