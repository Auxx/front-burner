import type { Config } from '@front-burner/server-core-config';
import { Database, loginAudit, sessions, users } from '@front-burner/server-core-database';
import type { JobRunner, JobTypeDefinition } from '@front-burner/server-core-jobs';
import { createTestDatabase } from '../testing/test-database';
import { AuthHousekeeping } from './auth-housekeeping';

const NOW = new Date('2026-10-27T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

describe('AuthHousekeeping', () => {
  let database: Database;
  let register: ReturnType<typeof vi.fn<(definition: JobTypeDefinition) => void>>;
  let housekeeping: AuthHousekeeping;
  let userId: number;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ 'Date' ] });
    vi.setSystemTime(NOW);
    database = createTestDatabase();
    userId = database.db.insert(users).values({
      email: 'alice@x.io',
      displayName: 'Alice',
      role: 'administrator',
      loginMethod: 'password',
      passwordHash: '$argon2id$hash',
      createdAt: at(-30 * DAY)
    }).returning().get().id;
    register = vi.fn();
    // FRONT_BURNER_LOGIN_AUDIT_RETENTION=1d
    housekeeping = new AuthHousekeeping(database, { loginAuditRetentionMs: DAY } as Config, {
      register
    } as unknown as JobRunner);
  });

  afterEach(() => {
    database.sqlite.close();
    vi.useRealTimers();
  });

  it('registers repeating housekeeping types', () => {
    housekeeping.onModuleInit();

    expect(register.mock.calls.map(([ definition ]) => definition)).toEqual([
      expect.objectContaining({
        type: 'auth.session-cleanup',
        pool: 'housekeeping',
        onInterrupted: 'requeue',
        spreadOnStart: true,
        repeatEveryMs: HOUR
      }),
      expect.objectContaining({ type: 'auth.login-audit-retention', pool: 'housekeeping', repeatEveryMs: DAY })
    ]);
  });

  it('deletes expired and revoked sessions only', () => {
    const insert = (id: string, expiresAt: Date, revokedAt: Date | null = null) =>
      database.db.insert(sessions).values({
        id,
        userId,
        loginMethod: 'password',
        refreshTokenDelivery: 'cookie',
        refreshTokenHash: 'hash',
        authTokenId: 'token',
        createdAt: at(-DAY),
        lastUsedAt: at(-DAY),
        expiresAt,
        revokedAt
      }).run();
    insert('active', at(DAY));
    insert('expired', at(-1));
    insert('revoked', at(DAY), at(-1));

    expect(housekeeping.deleteEndedSessions()).toBe(2);

    expect(database.db.select({ id: sessions.id }).from(sessions).all()).toEqual([ { id: 'active' } ]);
  });

  it('deletes entries older than the retention only', () => {
    const insert = (offsetMs: number) =>
      database.db.insert(loginAudit).values({
        at: at(offsetMs),
        method: 'password',
        outcome: 'success',
        reason: 'success',
        userId
      }).returning().get().id;
    const kept = [ insert(-DAY + 1), insert(-HOUR) ];
    insert(-DAY - 1);
    insert(-30 * DAY);

    expect(housekeeping.deleteOldAuditEntries()).toBe(2);

    expect(database.db.select({ id: loginAudit.id }).from(loginAudit).all().map(({ id }) => id)).toEqual(kept);
  });
});
