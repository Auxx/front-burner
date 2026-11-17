import type { Config, OidcEnvironment, RequiredClaim } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database, systemSettings } from '@front-burner/server-core-database';
import { createTestDatabase } from '../testing/test-database';
import { OidcSettingsService } from './oidc-settings.service';

const KEY = 'oidc-settings-spec-encryption-key-0123456789';
const ENVIRONMENT: OidcEnvironment = {
  issuer: 'https://env.example.com',
  clientId: 'env-client',
  clientSecret: 'env-secret',
  scopes: 'openid email',
  requireVerifiedEmail: false,
  adminEmail: 'admin@example.com'
};

describe('OidcSettingsService', () => {
  let database: Database;
  const box = new SecretBox(KEY);
  const service = (oidc?: OidcEnvironment, oidcRequiredClaim?: RequiredClaim) =>
    new OidcSettingsService({ oidc, oidcRequiredClaim } as Config, database, box);
  const saveSettings = () =>
    database.db.insert(systemSettings).values({
      id: 1,
      oidcIssuer: 'https://saved.example.com',
      oidcClientId: 'saved-client',
      oidcClientSecret: box.encrypt('saved-secret', { table: 'system_settings', recordId: 1 })
    }).run();

  beforeEach(() => {
    database = createTestDatabase();
  });

  afterEach(() => {
    database.sqlite.close();
  });

  it('is not configured without settings', () => {
    expect(service().current()).toBeUndefined();
    database.db.insert(systemSettings).values({ id: 1, oidcIssuer: 'https://saved.example.com' }).run();
    expect(service().current()).toBeUndefined();
  });

  it('reads the environment', () => {
    expect(service(ENVIRONMENT).current()).toEqual({
      source: 'environment',
      issuer: 'https://env.example.com',
      clientId: 'env-client',
      clientSecret: 'env-secret',
      scopes: 'openid email',
      requireVerifiedEmail: false
    });
  });

  it('prefers the environment over system settings', () => {
    saveSettings();
    expect(service(ENVIRONMENT).current()?.source).toBe('environment');
  });

  it('decrypts the stored client secret', () => {
    saveSettings();
    expect(service().current()).toEqual({
      source: 'onboarding',
      issuer: 'https://saved.example.com',
      clientId: 'saved-client',
      clientSecret: 'saved-secret',
      scopes: 'openid email profile',
      requireVerifiedEmail: true,
      requiredClaim: undefined
    });
  });

  describe('required claim (temporary, MVP)', () => {
    const SLACK = { name: 'https://slack.com/team_id', value: 'T123' };
    const saveClaim = () =>
      database.db.update(systemSettings).set({ oidcRequiredClaimName: 'hd', oidcRequiredClaimValue: 'example.com' })
        .run();

    it('has no required claim when none is set or saved', () => {
      saveSettings();
      expect(service().current()).toHaveProperty('requiredClaim', undefined);
      expect(service(ENVIRONMENT).current()).toHaveProperty('requiredClaim', undefined);
    });

    it('uses the saved required claim', () => {
      saveSettings();
      saveClaim();
      expect(service().current()?.requiredClaim).toEqual({ name: 'hd', value: 'example.com' });
    });

    it('the environment\'s required claim wins over the saved one', () => {
      saveSettings();
      saveClaim();
      expect(service(undefined, SLACK).current()?.requiredClaim).toEqual(SLACK);
    });

    it('applies the environment\'s required claim to OIDC from the environment', () => {
      expect(service(ENVIRONMENT, SLACK).current()?.requiredClaim).toEqual(SLACK);
    });
  });
});
