import {
  applyMigrations,
  Database,
  loginAudit,
  migrationState,
  openDatabase,
  sessions,
  users
} from '@front-burner/server-core-database';
import { MIGRATIONS_FOLDER, previousMigrations } from '@front-burner/server-core-database/testing';
import { PasswordHasher } from '@front-burner/server-feature-auth';
import { eq } from 'drizzle-orm';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { resetPassword } from './reset-password';

const OLD_PASSWORD = 'old password 1';
const NEW_PASSWORD = 'new password 2';
const ADMIN_EMAIL = 'admin@example.com';

describe('resetPassword', () => {
  let dataDir: string;
  let databaseFile: string;
  let output: string;
  let logs: string[];
  let adminId: number;
  const hasher = new PasswordHasher();

  /** Opens the database as the stopped instance left it, for the test's own reads and writes. */
  function withDatabase<T>(use: (database: Database) => T): T {
    const database = openDatabase(databaseFile);
    try {
      return use(database);
    } finally {
      database.sqlite.close();
    }
  }

  function insertUser(
    database: Database,
    email: string,
    loginMethod: 'password' | 'oidc',
    passwordHash: string | null
  ) {
    return database.db.insert(users).values({
      email,
      displayName: email,
      role: 'administrator',
      loginMethod,
      passwordHash,
      createdAt: new Date()
    }).returning().get().id;
  }

  function insertSession(database: Database, userId: number, id: string): void {
    const now = new Date();
    database.db.insert(sessions).values({
      id,
      userId,
      loginMethod: 'password',
      refreshTokenDelivery: 'cookie',
      refreshTokenHash: `hash-${id}`,
      authTokenId: `token-${id}`,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + 86_400_000)
    }).run();
  }

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'fb-reset-password-'));
    mkdirSync(join(dataDir, 'db'));
    databaseFile = join(dataDir, 'db', 'front-burner.sqlite');
    output = '';
    logs = [];
    const oldHash = await hasher.hash(OLD_PASSWORD);
    adminId = withDatabase(database => {
      applyMigrations(database, MIGRATIONS_FOLDER);
      const id = insertUser(database, ADMIN_EMAIL, 'password', oldHash);
      insertUser(database, 'oidc@example.com', 'oidc', null);
      insertSession(database, id, 'first');
      insertSession(database, id, 'second');
      return id;
    });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  const run = (
    email: string,
    input: string,
    migrationsFolder = MIGRATIONS_FOLDER
  ) => {
    const out = new PassThrough();
    out.on('data', chunk => (output += String(chunk)));
    return resetPassword({
      env: {
        FRONT_BURNER_DATA_DIR: dataDir,
        FRONT_BURNER_LOG_FORMAT: 'json',
        FRONT_BURNER_JWT_SECRET: 'server-spec-jwt-secret-0123456789abcdefghijklm',
        FRONT_BURNER_ENCRYPTION_KEY: 'server-spec-encryption-key-0123456789abcdefghi'
      },
      cwd: dataDir,
      email,
      input: Readable.from([ input ]),
      output: out,
      migrationsFolder,
      logDestination: { write: (line: string) => void logs.push(line) }
    });
  };

  const passwordHashOf = (userId: number) =>
    withDatabase(database =>
      database.db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).get()
        ?.passwordHash ?? null
    );

  async function expectUnchanged(): Promise<void> {
    expect(await hasher.verify(passwordHashOf(adminId) ?? '', OLD_PASSWORD)).toBe(true);
    expect(withDatabase(database => database.db.select().from(sessions).all().every(s => s.revokedAt === null))).toBe(
      true
    );
  }

  it('sets a new password and the user can log in with it', async () => {
    expect(await run(ADMIN_EMAIL, `${NEW_PASSWORD}\n${NEW_PASSWORD}\n`)).toBe(0);

    const passwordHash = passwordHashOf(adminId) ?? '';
    expect(await hasher.verify(passwordHash, NEW_PASSWORD)).toBe(true);
    expect(await hasher.verify(passwordHash, OLD_PASSWORD)).toBe(false);
    expect(output).toBe('');
  });

  it('matches the email ignoring case, as at login', async () => {
    expect(await run('Admin@Example.COM', `${NEW_PASSWORD}\n${NEW_PASSWORD}\n`)).toBe(0);
    expect(await hasher.verify(passwordHashOf(adminId) ?? '', NEW_PASSWORD)).toBe(true);
  });

  it('never trims the password (PP-2)', async () => {
    expect(await run(ADMIN_EMAIL, ` ${NEW_PASSWORD} \r\n ${NEW_PASSWORD} \r\n`)).toBe(0);
    expect(await hasher.verify(passwordHashOf(adminId) ?? '', ` ${NEW_PASSWORD} `)).toBe(true);
  });

  it('revokes every session of the user', async () => {
    await run(ADMIN_EMAIL, `${NEW_PASSWORD}\n${NEW_PASSWORD}\n`);

    const all = withDatabase(database => database.db.select().from(sessions).all());
    expect(all).toHaveLength(2);
    expect(all.every(session => session.revokedAt !== null)).toBe(true);
  });

  it('refuses a password that breaks the policy', async () => {
    expect(await run(ADMIN_EMAIL, 'short\nshort\n')).toBe(1);

    expect(output).toBe(
      'The password does not meet the password policy: it must be at least 10 characters long; mix at least two of '
        + 'lowercase letters, uppercase letters, other letters, digits and other characters\n'
    );
    await expectUnchanged();
  });

  it('refuses the user\'s own email as the password (PP-7)', async () => {
    expect(await run(ADMIN_EMAIL, 'ADMIN@example.com\nADMIN@example.com\n')).toBe(1);
    expect(output).toContain('not be the user\'s email');
    await expectUnchanged();
  });

  it('refuses when the two entries differ', async () => {
    expect(await run(ADMIN_EMAIL, `${NEW_PASSWORD}\n${NEW_PASSWORD}x\n`)).toBe(1);

    expect(output).toBe('The two entries differ; nothing was changed\n');
    await expectUnchanged();
  });

  it('refuses when the input ends before the second entry', async () => {
    expect(await run(ADMIN_EMAIL, `${NEW_PASSWORD}\n`)).toBe(1);

    expect(output).toBe('Expected the new password twice on standard input\n');
    await expectUnchanged();
  });

  it('refuses an unknown email', async () => {
    expect(await run('nobody@example.com', `${NEW_PASSWORD}\n${NEW_PASSWORD}\n`)).toBe(1);

    expect(output).toBe('No password user with this email\n');
    await expectUnchanged();
  });

  it('refuses a disabled user', async () => {
    withDatabase(database => database.db.update(users).set({ disabled: true }).where(eq(users.id, adminId)).run());

    expect(await run(ADMIN_EMAIL, `${NEW_PASSWORD}\n${NEW_PASSWORD}\n`)).toBe(1);

    expect(output).toBe('This user is disabled\n');
    await expectUnchanged();
  });

  it('refuses an OIDC user', async () => {
    expect(await run('oidc@example.com', `${NEW_PASSWORD}\n${NEW_PASSWORD}\n`)).toBe(1);

    expect(output).toBe('This user signs in with OIDC\n');
    await expectUnchanged();
  });

  it('refuses a database that needs migrations', async () => {
    // The database is one migration behind this version: the real folder has one more.
    rmSync(dataDir, { recursive: true, force: true });
    mkdirSync(join(dataDir, 'db'), { recursive: true });
    withDatabase(database => applyMigrations(database, previousMigrations(dataDir)));

    expect(await run(ADMIN_EMAIL, `${NEW_PASSWORD}\n${NEW_PASSWORD}\n`)).toBe(1);

    expect(output).toBe('Start the instance once to upgrade the database, then stop it and run this again\n');
    expect(withDatabase(database => migrationState(database, MIGRATIONS_FOLDER).pending)).toBe(1);
  });

  it('refuses a data directory without a database, and creates none', async () => {
    rmSync(databaseFile);

    expect(await run(ADMIN_EMAIL, `${NEW_PASSWORD}\n${NEW_PASSWORD}\n`)).toBe(1);

    expect(output).toBe(`No database in ${dataDir}; start the instance once first\n`);
  });

  it('logs the reset with the user\'s ID and without the password', async () => {
    await run(ADMIN_EMAIL, `${NEW_PASSWORD}\n${NEW_PASSWORD}\n`);

    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0])).toMatchObject({
      level: 'warn',
      userId: adminId,
      message: `Password of user ${adminId} reset from the command line; every session revoked`
    });
    expect(logs[0]).not.toContain(NEW_PASSWORD);
    expect(logs[0]).not.toContain(ADMIN_EMAIL);
  });

  it('writes nothing to the login audit log', async () => {
    await run(ADMIN_EMAIL, `${NEW_PASSWORD}\n${NEW_PASSWORD}\n`);
    await run(ADMIN_EMAIL, `${NEW_PASSWORD}\nother\n`);

    expect(withDatabase(database => database.db.select().from(loginAudit).all())).toEqual([]);
  });
});
