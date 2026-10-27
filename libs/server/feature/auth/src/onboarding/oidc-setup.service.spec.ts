import type { Config } from '@front-burner/server-core-config';
import { SecretBox } from '@front-burner/server-core-crypto';
import { Database, instanceState, systemSettings, users } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { EgressHttpClient } from '@front-burner/server-core-security';
import type { FieldError, OidcSetupRequest } from '@front-burner/shared-contracts';
import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { OIDC_CLIENT_SECRET_BINDING } from '../oidc/oidc-settings.service';
import { MockOidcProvider, startMockOidcProvider } from '../testing/mock-oidc-provider';
import { createTestDatabase } from '../testing/test-database';
import { OidcSetupService } from './oidc-setup.service';
import { OnboardingStateService } from './onboarding-state.service';

const KEY = 'oidc-setup-spec-encryption-key-0123456789';

/** The field errors of a refused submission, or a failure when it was not refused that way. */
async function fieldsOf(promise: Promise<unknown>): Promise<FieldError[]> {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiErrorException);
  return (error as ApiErrorException).fields ?? [];
}

describe('OidcSetupService', () => {
  let provider: MockOidcProvider;
  let egress: EgressHttpClient;
  let database: Database;
  const box = new SecretBox(KEY);
  let service: OidcSetupService;
  let request: OidcSetupRequest;

  const settingsRow = () => database.db.select().from(systemSettings).where(eq(systemSettings.id, 1)).get();
  const stateRow = () => database.db.select().from(instanceState).where(eq(instanceState.id, 1)).get();

  beforeEach(async () => {
    provider = await startMockOidcProvider();
    egress = new EgressHttpClient({ blockPrivateNetworks: false } as Config, { ca: provider.ca });
    database = createTestDatabase();
    new OnboardingStateService(database, { setupToken: 'a-setup-token-0123456789' } as Config).onModuleInit();
    service = new OidcSetupService(database, box, egress);
    request = {
      setupToken: 'a-setup-token-0123456789',
      issuer: provider.issuer,
      clientId: 'front-burner',
      clientSecret: 'client-secret',
      scopes: 'openid email profile',
      requireVerifiedEmail: true,
      adminEmail: 'admin@example.com'
    };
  });

  afterEach(async () => {
    await provider.stop();
    await egress.onModuleDestroy();
    database.sqlite.close();
  });

  it('saves the settings and puts onboarding in oidc-pending', async () => {
    await service.save({ ...request, requireVerifiedEmail: false });

    const row = settingsRow();
    expect(row).toMatchObject({
      oidcIssuer: provider.issuer,
      oidcClientId: 'front-burner',
      oidcScopes: 'openid email profile',
      oidcRequireVerifiedEmail: false,
      automaticRegistration: false
    });
    expect(row?.oidcClientSecret).not.toContain('client-secret');
    expect(box.decrypt(row?.oidcClientSecret ?? '', OIDC_CLIENT_SECRET_BINDING)).toBe('client-secret');
    expect(stateRow()).toMatchObject({ onboardingState: 'oidc-pending', pendingAdminEmail: 'admin@example.com' });
    expect(database.db.select().from(users).all()).toEqual([]);
  });

  it('refuses an issuer that differs from the discovery document\'s', async () => {
    const fields = await fieldsOf(service.save({ ...request, issuer: `${provider.issuer}/` }));
    expect(fields).toEqual([
      { path: 'issuer', code: 'oidc-issuer-mismatch', params: { expected: provider.issuer } }
    ]);
    expect(settingsRow()?.oidcIssuer ?? null).toBeNull();
    expect(stateRow()?.onboardingState).toBe('required');
  });

  it('reports an unreachable issuer on the field', async () => {
    const issuer = provider.issuer;
    await provider.stop();
    provider = await startMockOidcProvider();
    const fields = await fieldsOf(service.save({ ...request, issuer }));
    expect(fields).toEqual([
      { path: 'issuer', code: 'oidc-issuer-unreachable', params: { host: new URL(issuer).host } }
    ]);
    expect(settingsRow()?.oidcIssuer ?? null).toBeNull();
  });

  it('reports a blocked issuer as unreachable', async () => {
    const fields = await fieldsOf(service.save({ ...request, issuer: 'https://169.254.169.254' }));
    expect(fields).toEqual([
      { path: 'issuer', code: 'oidc-issuer-unreachable', params: { host: '169.254.169.254' } }
    ]);
  });

  it('reports an address without a discovery document', async () => {
    const fields = await fieldsOf(service.save({ ...request, issuer: `${provider.issuer}/nothing` }));
    expect(fields).toEqual([ { path: 'issuer', code: 'oidc-discovery-invalid', params: {} } ]);
  });

  it('keeps the saved secret when it is left blank', async () => {
    await service.save(request);
    await service.save({ ...request, clientId: 'another', clientSecret: '' });
    const row = settingsRow();
    expect(row?.oidcClientId).toBe('another');
    expect(box.decrypt(row?.oidcClientSecret ?? '', OIDC_CLIENT_SECRET_BINDING)).toBe('client-secret');

    await service.save({ ...request, clientSecret: undefined });
    expect(box.decrypt(settingsRow()?.oidcClientSecret ?? '', OIDC_CLIENT_SECRET_BINDING)).toBe('client-secret');
  });

  it('requires a secret when none is saved', async () => {
    const fields = await fieldsOf(service.save({ ...request, clientSecret: '' }));
    expect(fields).toEqual([ { path: 'clientSecret', code: 'required', params: {} } ]);
    expect(stateRow()?.onboardingState).toBe('required');
  });

  it('refuses once onboarding is completed', async () => {
    database.db.update(instanceState).set({ onboardingState: 'completed' }).run();
    await expect(service.save(request)).rejects.toBeInstanceOf(NotFoundException);
    expect(settingsRow()?.oidcIssuer ?? null).toBeNull();
  });

  it('returns the saved setup without the secret', async () => {
    expect(service.current()).toBeUndefined();
    await service.save(request);
    expect(service.current()).toEqual({
      issuer: provider.issuer,
      clientId: 'front-burner',
      scopes: 'openid email profile',
      requireVerifiedEmail: true,
      adminEmail: 'admin@example.com',
      hasClientSecret: true
    });
  });
});
