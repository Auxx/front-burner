import type { Config } from '@front-burner/server-core-config';
import { Database, loginAudit, NewUser, sessions, users } from '@front-burner/server-core-database';
import { EventsHub } from '@front-burner/server-core-events';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { SessionLifecycle } from '@front-burner/server-core-security';
import { Logger } from '@nestjs/common';
import { PasswordHasher } from '../passwords/password-hasher';
import { AuthTokenService } from '../sessions/auth-token.service';
import { SessionService } from '../sessions/session.service';
import { createTestDatabase } from '../testing/test-database';
import { LoginAuditService } from './login-audit.service';
import { PasswordLoginService } from './password-login.service';

const PASSWORD = 'correct horse 1';
const info = { ip: '203.0.113.7', userAgent: 'Browser' };
const config = {
  jwtSecret: 'password-login-spec-secret-0123456789abcdefghij',
  authTokenTtlMs: 15 * 60_000,
  refreshTokenTtlMs: 30 * 86_400_000
} as Config;

describe('PasswordLoginService', () => {
  const hasher = new PasswordHasher();
  let passwordHash: string;
  let database: Database;
  let service: PasswordLoginService;

  const login = (email: string, password = PASSWORD) =>
    service.login({ email, password, refreshTokenDelivery: 'cookie' }, info);
  const addUser = (user: Partial<NewUser> & { email: string; }) =>
    database.db.insert(users).values({
      displayName: 'Someone',
      role: 'user',
      loginMethod: 'password',
      passwordHash,
      createdAt: new Date(0),
      ...user
    }).returning().get();
  const audit = () => database.db.select().from(loginAudit).all();
  const failureOf = (promise: Promise<unknown>) => promise.then(() => undefined, (error: unknown) => error);

  beforeAll(async () => {
    passwordHash = await hasher.hash(PASSWORD);
  });

  beforeEach(() => {
    database = createTestDatabase();
    const sessionService = new SessionService(
      database,
      config,
      new AuthTokenService(config),
      () => undefined,
      new EventsHub(),
      new SessionLifecycle()
    );
    service = new PasswordLoginService(database, hasher, sessionService, new LoginAuditService(database));
  });

  afterEach(() => {
    database.sqlite.close();
    vi.restoreAllMocks();
  });

  it('logs in and records success', async () => {
    const alice = addUser({ email: 'alice@x.io' });
    const issued = await login('alice@x.io');

    expect(database.db.select().from(sessions).get()).toMatchObject({
      id: issued.sessionId,
      userId: alice.id,
      loginMethod: 'password',
      refreshTokenDelivery: 'cookie'
    });
    expect(audit()).toEqual([
      expect.objectContaining({
        method: 'password',
        outcome: 'success',
        reason: 'success',
        email: 'alice@x.io',
        userId: alice.id,
        sessionId: issued.sessionId,
        ip: info.ip,
        userAgent: info.userAgent
      })
    ]);
  });

  it('finds the user ignoring case and spaces', async () => {
    const alice = addUser({ email: 'Alice@x.io' });
    await login(' alice@X.IO ');
    expect(audit()[0]).toMatchObject({ outcome: 'success', email: 'alice@X.IO', userId: alice.id });
  });

  describe('failures', () => {
    async function expectFailure(attempt: () => Promise<unknown>, reason: string, userId: number | null) {
      const error = await failureOf(attempt());
      expect(error).toBeInstanceOf(ApiErrorException);
      const exception = error as ApiErrorException;
      expect({ status: exception.getStatus(), code: exception.code, message: exception.message }).toEqual({
        status: 401,
        code: 'wrong-credentials',
        message: 'Wrong username or password'
      });
      expect(audit()).toEqual([ expect.objectContaining({ outcome: 'failure', reason, userId }) ]);
      expect(database.db.select().from(sessions).all()).toEqual([]);
    }

    it('unknown-email', async () => {
      addUser({ email: 'alice@x.io' });
      await expectFailure(() => login('bob@x.io'), 'unknown-email', null);
    });

    it('not-password-user', async () => {
      const oidc = addUser({ email: 'alice@x.io', loginMethod: 'oidc', passwordHash: null });
      await expectFailure(() => login('alice@x.io'), 'not-password-user', oidc.id);
    });

    it('onboarding-not-finished', async () => {
      const invited = addUser({ email: 'alice@x.io', passwordHash: null });
      await expectFailure(() => login('alice@x.io'), 'onboarding-not-finished', invited.id);
    });

    it('wrong-password', async () => {
      const alice = addUser({ email: 'alice@x.io' });
      await expectFailure(() => login('alice@x.io', 'wrong horse 1'), 'wrong-password', alice.id);
    });

    it('wrong-password before user-disabled', async () => {
      const alice = addUser({ email: 'alice@x.io', disabled: true });
      await expectFailure(() => login('alice@x.io', 'wrong horse 1'), 'wrong-password', alice.id);
    });

    it('user-disabled', async () => {
      const alice = addUser({ email: 'alice@x.io', disabled: true });
      await expectFailure(() => login('alice@x.io'), 'user-disabled', alice.id);
    });
  });

  it('checks a hash even without one', async () => {
    const dummy = vi.spyOn(hasher, 'verifyAgainstDummy');
    const verify = vi.spyOn(hasher, 'verify');
    addUser({ email: 'oidc@x.io', loginMethod: 'oidc', passwordHash: null });
    addUser({ email: 'disabled@x.io', disabled: true });

    await failureOf(login('nobody@x.io'));
    await failureOf(login('oidc@x.io'));
    expect(dummy).toHaveBeenCalledTimes(2);

    dummy.mockClear();
    verify.mockClear();
    await failureOf(login('disabled@x.io'));
    expect(verify).toHaveBeenCalledWith(passwordHash, PASSWORD);
    expect(dummy).not.toHaveBeenCalled();
  });

  it('does not trim the password', async () => {
    addUser({ email: 'alice@x.io', passwordHash: await hasher.hash(' secret pass 1 ') });
    await expect(login('alice@x.io', 'secret pass 1')).rejects.toBeInstanceOf(ApiErrorException);
    await expect(login('alice@x.io', ' secret pass 1 ')).resolves.toMatchObject({ delivery: 'cookie' });
  });

  it('matches an NFD password against an NFC hash', async () => {
    const nfc = 'café crème 1'.normalize('NFC');
    addUser({ email: 'alice@x.io', passwordHash: await hasher.hash(nfc) });
    await expect(login('alice@x.io', nfc.normalize('NFD'))).resolves.toMatchObject({ delivery: 'cookie' });
  });

  it('still logs in when the audit insert fails', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    addUser({ email: 'alice@x.io' });
    database.sqlite.exec('DROP TABLE login_audit');

    await expect(login('alice@x.io')).resolves.toMatchObject({ delivery: 'cookie' });
    expect(error).toHaveBeenCalled();
  });

  it('logs success and failure without secrets', async () => {
    const log = vi.spyOn(Logger.prototype, 'log');
    addUser({ email: 'alice@x.io' });
    const issued = await login('alice@x.io');
    await failureOf(login('alice@x.io', 'wrong horse 1'));

    const messages = log.mock.calls.map(call => call[call.length - 1]);
    expect(messages).toEqual(expect.arrayContaining([ 'Login succeeded', 'Login failed' ]));
    const logged = JSON.stringify(log.mock.calls);
    for (const secret of [ PASSWORD, 'wrong horse 1', issued.refreshToken, issued.tokens.authToken ]) {
      expect(logged).not.toContain(secret);
    }
  });
});
