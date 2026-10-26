import { ONBOARDING_STATES } from '@front-burner/shared-contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../database/migrations';
import { Database, openDatabase } from '../database/open-database';
import { instanceState, LOGIN_AUDIT_REASONS, loginAudit, ONBOARDING_STATE_VALUES, sessions, users } from './index';

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

    expect(database.db.select().from(users).all()).toEqual([ { id: 1, ...alice, disabled: false } ]);
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

  it('defaults a user to enabled', () => {
    database.db.insert(users).values(alice).run();
    expect(database.db.select().from(users).all()[0]?.disabled).toBe(false);
  });

  it('deletes a user\'s sessions with the user', () => {
    const { id } = database.db.insert(users).values(alice).returning().get();
    database.db.insert(sessions).values({
      id: 'session-1',
      userId: id,
      loginMethod: 'password',
      refreshTokenDelivery: 'cookie',
      refreshTokenHash: 'hash',
      authTokenId: 'token-1',
      createdAt: new Date(0),
      lastUsedAt: new Date(0),
      expiresAt: new Date(1000)
    }).run();

    database.db.delete(users).run();

    expect(database.db.select().from(sessions).all()).toEqual([]);
  });

  it('keeps audit entries when their user is deleted', () => {
    const { id } = database.db.insert(users).values(alice).returning().get();
    database.db.insert(loginAudit).values({
      at: new Date(0),
      method: 'password',
      outcome: 'success',
      reason: 'success',
      email: 'alice@x.io',
      userId: id
    }).run();

    database.db.delete(users).run();

    const entries = database.db.select().from(loginAudit).all();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.userId).toBeNull();
  });
});

describe('LOGIN_AUDIT_REASONS', () => {
  it('lists LG-43', () => {
    expect(LOGIN_AUDIT_REASONS).toHaveLength(17);
    expect(LOGIN_AUDIT_REASONS[0]).toBe('success');
    expect(LOGIN_AUDIT_REASONS[16]).toBe('refresh-token-reused');
  });
});

describe('ONBOARDING_STATE_VALUES', () => {
  it('lists the states of the contracts', () => {
    expect(ONBOARDING_STATE_VALUES).toEqual(ONBOARDING_STATES);
  });
});
