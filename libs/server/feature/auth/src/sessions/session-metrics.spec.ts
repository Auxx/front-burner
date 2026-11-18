import { Database, NewSession, sessions, users } from '@front-burner/server-core-database';
import { Registry } from 'prom-client';
import { createTestDatabase } from '../testing/test-database';
import { ACTIVE_SESSIONS, SessionMetrics } from './session-metrics';

const HOUR = 3_600_000;

describe('SessionMetrics', () => {
  let database: Database;
  let registry: Registry;
  let userId: number;

  const session = (id: string, values: Partial<NewSession> = {}): NewSession => ({
    id,
    userId,
    loginMethod: 'password',
    refreshTokenDelivery: 'cookie',
    refreshTokenHash: 'hash',
    authTokenId: id,
    createdAt: new Date(Date.now() - HOUR),
    lastUsedAt: new Date(Date.now() - HOUR),
    expiresAt: new Date(Date.now() + HOUR),
    ...values
  });

  const active = async (): Promise<number | undefined> =>
    (await registry.getSingleMetric(ACTIVE_SESSIONS)?.get())?.values[0]?.value;

  beforeEach(() => {
    database = createTestDatabase();
    userId = database.db.insert(users).values({
      email: 'alice@x.io',
      displayName: 'Alice',
      role: 'administrator',
      loginMethod: 'password',
      passwordHash: '$argon2id$hash',
      createdAt: new Date()
    }).returning().get().id;
    registry = new Registry();
    new SessionMetrics(database, registry).onModuleInit();
  });

  afterEach(() => {
    database.sqlite.close();
  });

  it('counts active sessions on scrape', async () => {
    expect(await active()).toBe(0);

    database.db.insert(sessions).values([
      session('a'),
      session('b'),
      session('expired', { expiresAt: new Date(Date.now() - 1) }),
      session('revoked', { revokedAt: new Date() })
    ]).run();

    expect(await active()).toBe(2);
    const metrics = await registry.metrics();
    expect(metrics).toContain(`${ACTIVE_SESSIONS} 2`);
    expect(metrics).not.toContain('alice');
  });

  it('keeps the last count when the database cannot be read, so that the scrape still answers', async () => {
    database.db.insert(sessions).values([ session('a') ]).run();
    expect(await active()).toBe(1);

    database.sqlite.close();

    await expect(registry.metrics()).resolves.toContain(`${ACTIVE_SESSIONS} 1`);
    database = createTestDatabase();
  });
});
