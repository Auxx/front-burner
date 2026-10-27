import type { Config } from '@front-burner/server-core-config';
import { EgressHttpClient } from '@front-burner/server-core-security';
import { MockOidcProvider, startMockOidcProvider } from '../testing/mock-oidc-provider';
import { OidcProviderService } from './oidc-provider.service';
import { OidcSettings, OidcSettingsService } from './oidc-settings.service';

const settingsFor = (issuer: string): OidcSettings => ({
  source: 'environment',
  issuer,
  clientId: 'front-burner',
  clientSecret: 'client-secret',
  scopes: 'openid email profile',
  requireVerifiedEmail: true
});

describe('OidcProviderService', () => {
  let provider: MockOidcProvider | undefined;
  let egress: EgressHttpClient;
  let settings: OidcSettings | undefined;
  const service = () => new OidcProviderService({ current: () => settings } as OidcSettingsService, egress);

  beforeEach(async () => {
    provider = await startMockOidcProvider();
    egress = new EgressHttpClient({ blockPrivateNetworks: false } as Config, { ca: provider.ca });
    settings = settingsFor(provider.issuer);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await provider?.stop();
    await egress.onModuleDestroy();
  });

  it('is not configured without settings', async () => {
    settings = undefined;
    expect(await service().availability()).toBe('not-configured');
  });

  it('is available once discovery succeeds', async () => {
    const created = service();
    expect(await created.availability()).toBe('available');
    const configuration = await created.configuration();
    expect(configuration.serverMetadata().issuer).toBe(provider?.issuer);
    expect(await created.configuration()).toBe(configuration);
  });

  it('is unavailable when the issuer does not answer', async () => {
    await provider?.stop();
    provider = undefined;
    expect(await service().availability()).toBe('unavailable');
  });

  it('retries discovery after a minute', async () => {
    const port = provider?.port;
    await provider?.stop();
    provider = undefined;
    vi.useFakeTimers({ toFake: [ 'Date' ] });
    const created = service();
    expect(await created.availability()).toBe('unavailable');

    provider = await startMockOidcProvider({ port });
    vi.advanceTimersByTime(30_000);
    expect(await created.availability()).toBe('unavailable');
    vi.advanceTimersByTime(31_000);
    expect(await created.availability()).toBe('available');
  });

  it('discovers again when the settings change', async () => {
    const created = service();
    expect(await created.availability()).toBe('available');
    settings = settingsFor('https://localhost:1');
    expect(await created.availability()).toBe('unavailable');
  });
});
