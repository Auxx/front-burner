import type { Config } from '@front-burner/server-core-config';
import { Database, instanceState, systemSettings, users } from '@front-burner/server-core-database';
import { createTestDatabase } from '../testing/test-database';
import { OnboardingStateService } from './onboarding-state.service';

const config = { setupToken: 'a-setup-token-0123456789' } as Config;

const alice = {
  email: 'alice@example.com',
  displayName: 'Alice',
  role: 'administrator',
  loginMethod: 'password',
  passwordHash: '$argon2id$hash',
  createdAt: new Date()
} as const;

describe('OnboardingStateService', () => {
  let database: Database;

  beforeEach(() => {
    database = createTestDatabase();
  });

  afterEach(() => {
    database.sqlite.close();
  });

  const service = (withConfig: Config = config) => {
    const created = new OnboardingStateService(database, withConfig);
    created.onModuleInit();
    return created;
  };

  it('is required on an empty database', () => {
    expect(service().current()).toBe('required');
    expect(database.db.select().from(instanceState).all()).toEqual([
      { id: 1, onboardingState: 'required', encryptionCheck: null, pendingAdminEmail: null }
    ]);
  });

  it('is completed when a user exists', () => {
    database.db.insert(users).values(alice).run();
    expect(service().current()).toBe('completed');
  });

  it('repairs a required row when a user exists', () => {
    database.db.insert(instanceState).values({ id: 1, onboardingState: 'required' }).run();
    database.db.insert(users).values(alice).run();
    expect(service().current()).toBe('completed');
  });

  it('keeps a completed row', () => {
    database.db.insert(instanceState).values({ id: 1, onboardingState: 'completed' }).run();
    service();
    expect(service().current()).toBe('completed');
  });

  it('reads the state on every call', () => {
    const created = service();
    database.db.update(instanceState).set({ onboardingState: 'completed' }).run();
    expect(created.current()).toBe('completed');
  });

  it('reports whether a setup token is configured', () => {
    expect(service().status()).toEqual({
      state: 'required',
      oidcFromEnvironment: false,
      setupTokenConfigured: true
    });
    expect(service({ setupToken: undefined } as Config).status().setupTokenConfigured).toBe(false);
  });

  describe('with OIDC from the environment', () => {
    const oidcConfig = {
      ...config,
      oidc: {
        issuer: 'https://id.example.com',
        clientId: 'front-burner',
        clientSecret: 'client-secret',
        scopes: 'openid email profile',
        requireVerifiedEmail: true,
        adminEmail: 'admin@example.com'
      }
    } as Config;
    const withAdminEmail = (adminEmail: string) =>
      ({ ...oidcConfig, oidc: { ...oidcConfig.oidc, adminEmail } }) as Config;

    it('is oidc-pending with OIDC from the environment and no users', () => {
      const created = service(oidcConfig);
      expect(created.current()).toBe('oidc-pending');
      expect(created.status()).toEqual({
        state: 'oidc-pending',
        oidcFromEnvironment: true,
        setupTokenConfigured: true
      });
    });

    it('stores the administrator email and turns automatic registration off', () => {
      database.db.insert(systemSettings).values({ id: 1, automaticRegistration: true }).run();
      const created = service(oidcConfig);
      expect(created.pendingAdminEmail()).toBe('admin@example.com');
      expect(database.db.select().from(systemSettings).get()?.automaticRegistration).toBe(false);
    });

    it('creates the system settings row', () => {
      service(oidcConfig);
      expect(database.db.select().from(systemSettings).all()).toHaveLength(1);
      expect(database.db.select().from(systemSettings).get()?.automaticRegistration).toBe(false);
    });

    it('replaces the administrator email when the variable changes', () => {
      service(oidcConfig);
      expect(service(withAdminEmail('other@example.com')).pendingAdminEmail()).toBe('other@example.com');
    });

    it('is completed once a user exists, whatever the admin email', () => {
      database.db.insert(users).values(alice).run();
      const created = service(withAdminEmail('someone-else@example.com'));
      expect(created.current()).toBe('completed');
      expect(created.pendingAdminEmail()).toBeUndefined();
      expect(database.db.select().from(users).all()).toHaveLength(1);
    });

    it('is required again when the variables are removed before any login', () => {
      service(oidcConfig);
      const created = service();
      expect(created.current()).toBe('required');
      expect(created.pendingAdminEmail()).toBeUndefined();
    });
  });
});
