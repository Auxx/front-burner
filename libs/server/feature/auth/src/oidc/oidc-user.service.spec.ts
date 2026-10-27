import type { Config } from '@front-burner/server-core-config';
import { Database, instanceState, NewUser, systemSettings, users } from '@front-burner/server-core-database';
import { OnboardingStateService } from '../onboarding/onboarding-state.service';
import { createTestDatabase } from '../testing/test-database';
import type { OidcSettings } from './oidc-settings.service';
import { OidcIdentity, OidcUserService } from './oidc-user.service';

const ISSUER = 'https://id.example.com';
const settings: OidcSettings = {
  source: 'environment',
  issuer: ISSUER,
  clientId: 'front-burner',
  clientSecret: 'client-secret',
  scopes: 'openid email profile',
  requireVerifiedEmail: true
};
const identity: OidcIdentity = {
  issuer: ISSUER,
  subject: 'subject-1',
  email: 'Ada@Example.com',
  emailVerified: true,
  name: 'Ada Admin'
};

describe('OidcUserService', () => {
  let database: Database;
  let state: OnboardingStateService;
  let service: OidcUserService;

  const userCount = () => database.db.select().from(users).all().length;
  const addUser = (user: Partial<NewUser> & { email: string; }) =>
    database.db.insert(users).values({
      displayName: 'Someone',
      role: 'user',
      loginMethod: 'oidc',
      createdAt: new Date(0),
      ...user
    }).returning().get();
  const setAutomaticRegistration = (automaticRegistration: boolean) =>
    database.db.insert(systemSettings).values({ id: 1, automaticRegistration }).onConflictDoUpdate({
      target: systemSettings.id,
      set: { automaticRegistration }
    }).run();
  const startPending = (adminEmail = 'ada@example.com') => {
    state = new OnboardingStateService(database, { oidc: { adminEmail } } as Config);
    state.onModuleInit();
    service = new OidcUserService(database, state);
  };

  beforeEach(() => {
    database = createTestDatabase();
    state = new OnboardingStateService(database, {} as Config);
    state.onModuleInit();
    service = new OidcUserService(database, state);
  });

  afterEach(() => {
    database.sqlite.close();
  });

  describe('verified email', () => {
    it('refuses an unverified email when required', () => {
      addUser({ email: 'ada@example.com', oidcIssuer: ISSUER, oidcSubject: 'subject-1' });
      for (const emailVerified of [ false, undefined ]) {
        expect(service.resolve({ ...identity, emailVerified }, settings)).toEqual({
          ok: false,
          reason: 'email-not-verified'
        });
      }
    });

    it('accepts it when not required', () => {
      const user = addUser({ email: 'ada@example.com', oidcIssuer: ISSUER, oidcSubject: 'subject-1' });
      const result = service.resolve({ ...identity, emailVerified: false }, {
        ...settings,
        requireVerifiedEmail: false
      });
      expect(result).toEqual({ ok: true, user, completedOnboarding: false });
    });
  });

  describe('while onboarding is oidc-pending', () => {
    it('creates the pending administrator and completes onboarding', () => {
      startPending();
      const result = service.resolve({ ...identity, email: 'ada@example.com' }, settings);
      expect(result).toEqual({
        ok: true,
        completedOnboarding: true,
        user: expect.objectContaining({
          email: 'ada@example.com',
          displayName: 'Ada Admin',
          role: 'administrator',
          loginMethod: 'oidc',
          passwordHash: null,
          oidcIssuer: ISSUER,
          oidcSubject: 'subject-1'
        })
      });
      expect(database.db.select().from(instanceState).get()).toMatchObject({
        onboardingState: 'completed',
        pendingAdminEmail: null
      });
    });

    it('accepts the pending administrator in another case', () => {
      startPending('ada@example.com');
      const result = service.resolve({ ...identity, name: undefined }, settings);
      expect(result).toMatchObject({ ok: true, user: { email: 'Ada@Example.com', displayName: 'Ada' } });
    });

    it('refuses another email while pending and creates no user', () => {
      startPending();
      expect(service.resolve({ ...identity, email: 'eve@example.com' }, settings)).toEqual({
        ok: false,
        reason: 'admin-email-mismatch'
      });
      expect(service.resolve({ ...identity, email: undefined }, settings)).toEqual({
        ok: false,
        reason: 'admin-email-mismatch'
      });
      expect(userCount()).toBe(0);
      expect(state.current()).toBe('oidc-pending');
    });

    it('completes onboarding only while it is pending', () => {
      startPending();
      // A password onboarding completes between the state check and the transaction.
      const stale = { current: () => 'oidc-pending', pendingAdminEmail: () => 'ada@example.com' };
      service = new OidcUserService(database, stale as unknown as OnboardingStateService);
      addUser({ email: 'root@example.com', role: 'administrator', loginMethod: 'password', passwordHash: 'x' });
      database.db.update(instanceState).set({ onboardingState: 'completed', pendingAdminEmail: null }).run();

      expect(service.resolve(identity, settings)).toEqual({ ok: false, reason: 'registration-disabled' });
      expect(userCount()).toBe(1);
    });
  });

  it('finds a linked user', () => {
    const user = addUser({ email: 'old@example.com', oidcIssuer: ISSUER, oidcSubject: 'subject-1' });
    expect(service.resolve(identity, settings)).toEqual({ ok: true, user, completedOnboarding: false });
  });

  it('links an OIDC user by email', () => {
    const user = addUser({ email: 'ada@example.com' });
    const result = service.resolve(identity, settings);
    expect(result).toEqual({
      ok: true,
      completedOnboarding: false,
      user: { ...user, oidcIssuer: ISSUER, oidcSubject: 'subject-1' }
    });
    expect(database.db.select().from(users).get()).toMatchObject({ oidcIssuer: ISSUER, oidcSubject: 'subject-1' });
  });

  it('does not link an OIDC user linked to another identity', () => {
    setAutomaticRegistration(true);
    addUser({ email: 'ada@example.com', oidcIssuer: ISSUER, oidcSubject: 'subject-2' });
    expect(service.resolve(identity, settings)).toEqual({ ok: false, reason: 'registration-disabled' });
    expect(userCount()).toBe(1);
  });

  it('refuses a password user\'s email', () => {
    const user = addUser({ email: 'ada@example.com', loginMethod: 'password', passwordHash: 'x' });
    expect(service.resolve(identity, settings)).toEqual({ ok: false, reason: 'password-user', userId: user.id });
  });

  it('refuses an unknown email without automatic registration and creates it with', () => {
    expect(service.resolve(identity, settings)).toEqual({ ok: false, reason: 'registration-disabled' });
    expect(userCount()).toBe(0);

    setAutomaticRegistration(true);
    const result = service.resolve(identity, settings);
    expect(result).toEqual({
      ok: true,
      completedOnboarding: false,
      user: expect.objectContaining({
        email: 'Ada@Example.com',
        displayName: 'Ada Admin',
        role: 'user',
        loginMethod: 'oidc',
        oidcIssuer: ISSUER,
        oidcSubject: 'subject-1'
      })
    });
  });

  it('refuses an identity without an email that it cannot link', () => {
    setAutomaticRegistration(true);
    expect(service.resolve({ ...identity, email: undefined }, settings)).toEqual({
      ok: false,
      reason: 'invalid-id-token'
    });
    expect(userCount()).toBe(0);
  });

  it('refuses a disabled user', () => {
    const linked = addUser({ email: 'ada@example.com', oidcIssuer: ISSUER, oidcSubject: 'subject-1', disabled: true });
    expect(service.resolve(identity, settings)).toEqual({ ok: false, reason: 'user-disabled', userId: linked.id });

    database.db.delete(users).run();
    const unlinked = addUser({ email: 'ada@example.com', disabled: true });
    expect(service.resolve(identity, settings)).toEqual({ ok: false, reason: 'user-disabled', userId: unlinked.id });
  });
});
