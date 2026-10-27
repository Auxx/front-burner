import {
  CLONE_MODES as CONTRACT_CLONE_MODES,
  GIT_LEVELS as CONTRACT_GIT_LEVELS,
  ONBOARDING_STATES,
  REPOSITORY_ERRORS,
  REPOSITORY_STATUSES
} from '@front-burner/shared-contracts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../database/migrations';
import { Database, openDatabase } from '../database/open-database';
import {
  CLONE_MODES,
  ENCRYPTED_COLUMNS,
  GIT_LEVELS,
  instanceState,
  jobs,
  knownHosts,
  LOGIN_AUDIT_REASONS,
  loginAudit,
  ONBOARDING_STATE_VALUES,
  repositories,
  REPOSITORY_ERROR_VALUES,
  REPOSITORY_STATUS_VALUES,
  savedCredentials,
  sessions,
  systemSettings,
  users
} from './index';

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

    expect(database.db.select().from(users).all()).toEqual([
      { id: 1, ...alice, disabled: false, oidcIssuer: null, oidcSubject: null, allowedGitLevels: [ 'advanced' ] }
    ]);
    expect(database.db.select().from(instanceState).all()).toEqual([
      { id: 1, onboardingState: 'completed', encryptionCheck: null, pendingAdminEmail: null }
    ]);
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

  it('refuses a second user with the same OIDC identity', () => {
    const identity = { oidcIssuer: 'https://id.example.com', oidcSubject: 'sub-1' };
    database.db.insert(users).values({ ...alice, ...identity, loginMethod: 'oidc', passwordHash: null }).run();
    expect(() =>
      database.db.insert(users).values({
        ...alice,
        ...identity,
        email: 'bob@x.io',
        loginMethod: 'oidc',
        passwordHash: null
      }).run()
    ).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }));
  });

  it('allows many users without one', () => {
    database.db.insert(users).values(alice).run();
    database.db.insert(users).values({ ...alice, email: 'bob@x.io' }).run();
    expect(database.db.select().from(users).all()).toHaveLength(2);
  });

  it('allows only one system_settings row', () => {
    database.db.insert(systemSettings).values({ id: 1 }).run();
    expect(database.db.select().from(systemSettings).all()).toEqual([ {
      id: 1,
      automaticRegistration: false,
      oidcIssuer: null,
      oidcClientId: null,
      oidcClientSecret: null,
      oidcScopes: null,
      oidcRequireVerifiedEmail: null
    } ]);
    expect(() => database.db.insert(systemSettings).values({ id: 2 }).run()).toThrow(
      expect.objectContaining({ code: 'SQLITE_CONSTRAINT_CHECK' })
    );
  });

  it('allows only Advanced by default', () => {
    database.db.insert(users).values(alice).run();
    expect(database.db.select().from(users).all()[0]?.allowedGitLevels).toEqual([ 'advanced' ]);
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

  describe('repositories', () => {
    const handbook = {
      name: 'Handbook',
      remoteUrl: 'https://github.com/acme/handbook.git',
      cloneMode: 'full',
      gitLevel: 'advanced',
      status: 'ready',
      createdAt: new Date(0),
      lastAccessedAt: new Date(0)
    } as const;

    it('refuses a second name differing only in case for one user', () => {
      const { id } = database.db.insert(users).values(alice).returning().get();
      database.db.insert(repositories).values({ ...handbook, userId: id }).run();
      expect(() => database.db.insert(repositories).values({ ...handbook, userId: id, name: 'HANDBOOK' }).run())
        .toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }));
    });

    it('allows the same name for two users', () => {
      const a = database.db.insert(users).values(alice).returning().get();
      const b = database.db.insert(users).values({ ...alice, email: 'bob@x.io' }).returning().get();
      database.db.insert(repositories).values({ ...handbook, userId: a.id }).run();
      database.db.insert(repositories).values({ ...handbook, userId: b.id }).run();
      expect(database.db.select().from(repositories).all()).toHaveLength(2);
    });

    it('deletes a user\'s repositories with the user', () => {
      const { id } = database.db.insert(users).values(alice).returning().get();
      database.db.insert(repositories).values({ ...handbook, userId: id }).run();

      database.db.delete(users).run();

      expect(database.db.select().from(repositories).all()).toEqual([]);
    });

    it('stores no branch or error by default', () => {
      const { id } = database.db.insert(users).values(alice).returning().get();
      const row = database.db.insert(repositories).values({ ...handbook, userId: id }).returning().get();
      expect(row).toMatchObject({ branch: null, errorCode: null, credentialId: null });
    });

    it('sets the credential to null when it is deleted', () => {
      const { id } = database.db.insert(users).values(alice).returning().get();
      const credential = database.db.insert(savedCredentials).values({
        userId: id,
        kind: 'https',
        name: 'Work',
        username: 'alice',
        secret: 'encrypted',
        createdAt: new Date(0)
      }).returning().get();
      database.db.insert(repositories).values({ ...handbook, userId: id, credentialId: credential.id }).run();

      database.db.delete(savedCredentials).run();

      expect(database.db.select().from(repositories).all()).toMatchObject([ { credentialId: null } ]);
    });

    it('deletes a repository\'s jobs with it', () => {
      const { id } = database.db.insert(users).values(alice).returning().get();
      const repository = database.db.insert(repositories).values({ ...handbook, userId: id }).returning().get();
      database.db.insert(jobs).values({
        type: 'repositories.clone',
        status: 'queued',
        runAt: new Date(0),
        createdAt: new Date(0),
        userId: id,
        repositoryId: repository.id
      }).run();

      database.db.delete(repositories).run();

      expect(database.db.select().from(jobs).all()).toEqual([]);
    });
  });

  describe('jobs', () => {
    const job = { type: 'repository.clone', status: 'queued', runAt: new Date(0), createdAt: new Date(0) } as const;

    it('allows one unfinished job per dedupe key', () => {
      const first = database.db.insert(jobs).values({ ...job, dedupeKey: 'clone:1' }).returning().get();
      expect(() => database.db.insert(jobs).values({ ...job, dedupeKey: 'clone:1' }).run()).toThrow(
        expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' })
      );

      database.db.update(jobs).set({ status: 'done' }).run();
      database.db.insert(jobs).values({ ...job, dedupeKey: 'clone:1' }).run();

      expect(database.db.select().from(jobs).all().map(row => row.id)).toEqual([ first.id, first.id + 1 ]);
    });

    it('deletes a user\'s jobs with the user', () => {
      const { id } = database.db.insert(users).values(alice).returning().get();
      database.db.insert(jobs).values({ ...job, userId: id }).run();

      database.db.delete(users).run();

      expect(database.db.select().from(jobs).all()).toEqual([]);
    });

    it('stores an empty payload by default', () => {
      const row = database.db.insert(jobs).values(job).returning().get();
      expect(row).toMatchObject({ payload: '{}', attempts: 0, progress: null, dedupeKey: null, repositoryId: null });
    });
  });

  describe('saved_credentials', () => {
    const work = {
      kind: 'https',
      name: 'Work',
      username: 'alice',
      secret: 'encrypted',
      createdAt: new Date(0)
    } as const;

    it('refuses a second name of the same kind differing only in case', () => {
      const { id } = database.db.insert(users).values(alice).returning().get();
      database.db.insert(savedCredentials).values({ ...work, userId: id }).run();
      expect(() => database.db.insert(savedCredentials).values({ ...work, userId: id, name: 'WORK' }).run())
        .toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }));
    });

    it('allows the same name for an HTTPS credential and an SSH key', () => {
      const { id } = database.db.insert(users).values(alice).returning().get();
      database.db.insert(savedCredentials).values({ ...work, userId: id }).run();
      database.db.insert(savedCredentials).values({ ...work, userId: id, kind: 'ssh-key', username: null }).run();
      expect(database.db.select().from(savedCredentials).all()).toHaveLength(2);
    });

    it('deletes a user\'s saved credentials with the user', () => {
      const { id } = database.db.insert(users).values(alice).returning().get();
      database.db.insert(savedCredentials).values({ ...work, userId: id }).run();

      database.db.delete(users).run();

      expect(database.db.select().from(savedCredentials).all()).toEqual([]);
    });
  });

  describe('known_hosts', () => {
    const host = {
      host: 'git.example.com',
      port: 22,
      keyType: 'ssh-ed25519',
      publicKey: 'AAAAC3NzaC1lZDI1NTE5AAAAIA',
      fingerprint: 'SHA256:abc',
      createdAt: new Date(0)
    } as const;

    it('refuses a second key of one type for one host and port', () => {
      const { id } = database.db.insert(users).values(alice).returning().get();
      database.db.insert(knownHosts).values({ ...host, userId: id }).run();
      expect(() =>
        database.db.insert(knownHosts).values({ ...host, userId: id, publicKey: 'other', fingerprint: 'SHA256:x' })
          .run()
      ).toThrow(expect.objectContaining({ code: 'SQLITE_CONSTRAINT_UNIQUE' }));
      database.db.insert(knownHosts).values({ ...host, userId: id, port: 2222 }).run();
      database.db.insert(knownHosts).values({ ...host, userId: id, keyType: 'ssh-rsa' }).run();
      expect(database.db.select().from(knownHosts).all()).toHaveLength(3);
    });
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

describe('ENCRYPTED_COLUMNS', () => {
  it('registers the client secret as encrypted', () => {
    expect(ENCRYPTED_COLUMNS).toContainEqual({ table: systemSettings, column: systemSettings.oidcClientSecret });
  });

  it('registers the secret as encrypted', () => {
    expect(ENCRYPTED_COLUMNS).toContainEqual({ table: savedCredentials, column: savedCredentials.secret });
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

describe('repository value lists', () => {
  it('lists the contracts\' values', () => {
    expect(CLONE_MODES).toEqual(CONTRACT_CLONE_MODES);
    expect(GIT_LEVELS).toEqual(CONTRACT_GIT_LEVELS);
    expect(REPOSITORY_ERROR_VALUES).toEqual(REPOSITORY_ERRORS);
  });

  it('stores every status but the unbuilt needs-confirmation', () => {
    expect(REPOSITORY_STATUS_VALUES).toEqual(REPOSITORY_STATUSES.filter(status => status !== 'needs-confirmation'));
  });
});
