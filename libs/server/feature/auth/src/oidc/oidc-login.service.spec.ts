import { Config, ConfigModule } from '@front-burner/server-core-config';
import { CryptoModule } from '@front-burner/server-core-crypto';
import { Database, DatabaseModule, loginAudit, users } from '@front-burner/server-core-database';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { EgressHttpClient, EgressModule } from '@front-burner/server-core-security';
import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthModule } from '../auth.module';
import { MockOidcProvider, startMockOidcProvider } from '../testing/mock-oidc-provider';
import { createTestDatabase } from '../testing/test-database';
import { OidcLoginService } from './oidc-login.service';

const REDIRECT_URI = 'https://fb.example.com/api/v1/auth/oidc/callback';
const info = { ip: '203.0.113.7', userAgent: 'spec' };

describe('OidcLoginService', () => {
  let provider: MockOidcProvider;
  let egress: EgressHttpClient;
  let database: Database;
  let app: INestApplicationContext;
  let service: OidcLoginService;

  /** Follows the authorization redirect like a browser would, and returns the callback URL. */
  async function authorize(): Promise<{ callbackUrl: URL; state: string; }> {
    const { authorizationUrl, state } = await service.start(REDIRECT_URI);
    const response = await egress.fetch(authorizationUrl, { redirect: 'manual' });
    return { callbackUrl: new URL(response.headers.get('location') ?? ''), state };
  }
  const audits = () => database.db.select().from(loginAudit).all();

  beforeEach(async () => {
    provider = await startMockOidcProvider();
    const config = {
      jwtSecret: 'oidc-login-spec-jwt-secret-0123456789abcdefgh',
      encryptionKey: 'oidc-login-spec-encryption-key-0123456789abcd',
      blockPrivateNetworks: false,
      authTokenTtlMs: 15 * 60_000,
      refreshTokenTtlMs: 30 * 86_400_000,
      oidc: {
        issuer: provider.issuer,
        clientId: 'front-burner',
        clientSecret: 'client-secret',
        scopes: 'openid email profile',
        requireVerifiedEmail: true,
        adminEmail: 'admin@example.com'
      }
    } as Config;
    egress = new EgressHttpClient(config, { ca: provider.ca });
    database = createTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(config),
        DatabaseModule.forRoot(database),
        CryptoModule.forRoot(config),
        EgressModule,
        AuthModule
      ]
    }).overrideProvider(EgressHttpClient).useValue(egress).compile();
    app = await moduleRef.init();
    service = app.get(OidcLoginService);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
    await egress.onModuleDestroy();
    await provider.stop();
    database.sqlite.close();
  });

  it('starts with PKCE, state and nonce', async () => {
    const { authorizationUrl, state } = await service.start(REDIRECT_URI);
    const params = authorizationUrl.searchParams;
    expect(authorizationUrl.origin).toBe(provider.issuer);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('client_id')).toBe('front-burner');
    expect(params.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(params.get('scope')).toBe('openid email profile');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(params.get('state')).toBe(state);
    expect(params.get('nonce')).toMatch(/^[\w-]{20,}$/);
  });

  it('logs in through the provider', async () => {
    const { callbackUrl, state } = await authorize();
    const outcome = await service.complete(callbackUrl, state, info);
    expect(outcome).toEqual({ ok: true, code: expect.any(String) });
    expect(audits()).toEqual([]);

    const issued = await service.exchange((outcome as { code: string; }).code, state, 'body', info);
    expect(issued.tokens.refreshToken).toEqual(expect.any(String));
    const [ user ] = database.db.select().from(users).all();
    expect(user).toMatchObject({ email: 'admin@example.com', role: 'administrator', oidcSubject: 'subject-1' });
    expect(audits()).toEqual([ expect.objectContaining({
      method: 'oidc',
      outcome: 'success',
      reason: 'success',
      email: 'admin@example.com',
      issuer: provider.issuer,
      subject: 'subject-1',
      userId: user?.id,
      sessionId: issued.sessionId,
      ip: '203.0.113.7'
    }) ]);
  });

  it('refuses a callback without the state cookie', async () => {
    const { callbackUrl, state } = await authorize();
    expect(await service.complete(callbackUrl, undefined, info)).toEqual({ ok: false, reason: 'state-mismatch' });
    expect(await service.complete(callbackUrl, `${state}x`, info)).toEqual({ ok: false, reason: 'state-mismatch' });
    expect(database.db.select().from(users).all()).toEqual([]);
    expect(audits().map(entry => entry.reason)).toEqual([ 'state-mismatch', 'state-mismatch' ]);
  });

  it('uses a pending login once', async () => {
    const { callbackUrl, state } = await authorize();
    expect(await service.complete(callbackUrl, state, info)).toMatchObject({ ok: true });
    expect(await service.complete(callbackUrl, state, info)).toEqual({ ok: false, reason: 'state-mismatch' });
  });

  it('reports a cancelled login as provider-error with the provider\'s code', async () => {
    provider.failAuthorization('access_denied', 'The user cancelled.');
    const { callbackUrl, state } = await authorize();
    expect(await service.complete(callbackUrl, state, info)).toEqual({ ok: false, reason: 'provider-error' });
    expect(audits()).toEqual([ expect.objectContaining({
      method: 'oidc',
      outcome: 'failure',
      reason: 'provider-error',
      providerError: 'access_denied',
      providerErrorDescription: 'The user cancelled.'
    }) ]);
  });

  it('reports a failed token request as code-exchange-failed', async () => {
    provider.failTokenRequest(400);
    const { callbackUrl, state } = await authorize();
    expect(await service.complete(callbackUrl, state, info)).toEqual({ ok: false, reason: 'code-exchange-failed' });
    expect(audits()[0]).toMatchObject({ providerError: 'invalid_grant' });
  });

  it('reports an unreachable provider as provider-unreachable', async () => {
    const { callbackUrl, state } = await authorize();
    await provider.stop();
    expect(await service.complete(callbackUrl, state, info)).toEqual({ ok: false, reason: 'provider-unreachable' });
    provider = await startMockOidcProvider();
  });

  it('reports a wrong nonce as invalid-id-token', async () => {
    provider.setClaims({ nonce: 'x' });
    const { callbackUrl, state } = await authorize();
    expect(await service.complete(callbackUrl, state, info)).toEqual({ ok: false, reason: 'invalid-id-token' });
  });

  it('audits a refused user with the identity', async () => {
    provider.setClaims({ email: 'eve@example.com' });
    const { callbackUrl, state } = await authorize();
    expect(await service.complete(callbackUrl, state, info)).toEqual({ ok: false, reason: 'admin-email-mismatch' });
    expect(audits()).toEqual([ expect.objectContaining({
      reason: 'admin-email-mismatch',
      email: 'eve@example.com',
      issuer: provider.issuer,
      subject: 'subject-1'
    }) ]);
  });

  it('refuses a code without the state of the browser that completed the login', async () => {
    const { callbackUrl, state } = await authorize();
    const outcome = await service.complete(callbackUrl, state, info) as { code: string; };
    await expect(service.exchange(outcome.code, undefined, 'body', info)).rejects.toMatchObject({
      code: 'oidc-code-invalid'
    });
  });

  it('expires a code after 60 seconds', async () => {
    const { callbackUrl, state } = await authorize();
    const outcome = await service.complete(callbackUrl, state, info) as { code: string; };
    vi.useFakeTimers({ toFake: [ 'Date' ] });
    vi.advanceTimersByTime(60_001);
    await expect(service.exchange(outcome.code, state, 'body', info)).rejects.toThrow(ApiErrorException);
  });

  it('uses a code once', async () => {
    const { callbackUrl, state } = await authorize();
    const outcome = await service.complete(callbackUrl, state, info) as { code: string; };
    await service.exchange(outcome.code, state, 'body', info);
    await expect(service.exchange(outcome.code, state, 'body', info)).rejects.toMatchObject({
      status: 401,
      code: 'oidc-code-invalid'
    });
  });
});
