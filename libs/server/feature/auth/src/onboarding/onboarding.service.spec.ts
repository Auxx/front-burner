import type { Config } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database, instanceState, systemSettings, users } from '@front-burner/server-core-database';
import { NotFoundException } from '@nestjs/common';
import { OIDC_CLIENT_SECRET_BINDING, OidcSettingsService } from '../oidc/oidc-settings.service';
import { PasswordHasher } from '../passwords/password-hasher';
import { createTestDatabase } from '../testing/test-database';
import { OnboardingStateService } from './onboarding-state.service';
import { OnboardingService } from './onboarding.service';

const request = (email: string) => ({
  setupToken: 'a-setup-token-0123456789',
  email,
  displayName: 'Admin',
  password: 'abcdefghi1'
});

describe('OnboardingService', () => {
  let database: Database;
  let service: OnboardingService;
  let state: OnboardingStateService;

  beforeEach(() => {
    database = createTestDatabase();
    state = new OnboardingStateService(database, { setupToken: 'a-setup-token-0123456789' } as Config);
    state.onModuleInit();
    service = new OnboardingService(database, new PasswordHasher());
  });

  afterEach(() => {
    database.sqlite.close();
  });

  it('creates the administrator and completes onboarding', async () => {
    await service.setUpPassword(request('alice@example.com'));
    expect(state.current()).toBe('completed');
    expect(database.db.select().from(users).all()).toHaveLength(1);
  });

  it('of two concurrent setups exactly one succeeds', async () => {
    const results = await Promise.allSettled([
      service.setUpPassword(request('alice@example.com')),
      service.setUpPassword(request('bob@example.com'))
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter(result => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(NotFoundException);
    expect(database.db.select().from(users).all()).toHaveLength(1);
  });

  it('refuses once onboarding is completed', async () => {
    await service.setUpPassword(request('alice@example.com'));
    await expect(service.setUpPassword(request('bob@example.com'))).rejects.toBeInstanceOf(NotFoundException);
  });

  /** What OidcSetupService.save leaves behind (AO-24). */
  function savePendingOidcSetup(box: SecretBox): void {
    database.db.insert(systemSettings).values({
      id: 1,
      oidcIssuer: 'https://id.example.com',
      oidcClientId: 'front-burner',
      oidcClientSecret: box.encrypt('client-secret', OIDC_CLIENT_SECRET_BINDING),
      oidcScopes: 'openid',
      oidcRequireVerifiedEmail: true,
      automaticRegistration: false
    }).run();
    database.db.update(instanceState).set({ onboardingState: 'oidc-pending', pendingAdminEmail: 'oidc@example.com' })
      .run();
  }

  it('discards the pending OIDC setup', async () => {
    const box = new SecretBox('onboarding-service-spec-key-0123456789');
    savePendingOidcSetup(box);
    const oidcSettings = new OidcSettingsService({ oidc: undefined } as Config, database, box);
    expect(oidcSettings.current()).toBeDefined();

    await service.setUpPassword(request('alice@example.com'));

    expect(state.current()).toBe('completed');
    expect(state.pendingAdminEmail()).toBeUndefined();
    expect(database.db.select().from(instanceState).get()?.pendingAdminEmail).toBeNull();
    expect(oidcSettings.current()).toBeUndefined();
    expect(database.db.select().from(systemSettings).get()).toMatchObject({
      oidcIssuer: null,
      oidcClientId: null,
      oidcClientSecret: null,
      oidcScopes: null,
      oidcRequireVerifiedEmail: null
    });
    expect(database.db.select().from(users).all()).toEqual([
      expect.objectContaining({ email: 'alice@example.com', loginMethod: 'password', role: 'administrator' })
    ]);
  });

  it('still refuses a completed onboarding', async () => {
    database.db.update(instanceState).set({ onboardingState: 'completed' }).run();
    await expect(service.setUpPassword(request('bob@example.com'))).rejects.toBeInstanceOf(NotFoundException);
    expect(database.db.select().from(users).all()).toEqual([]);
  });
});
