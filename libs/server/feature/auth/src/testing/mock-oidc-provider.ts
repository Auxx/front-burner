import { TEST_CERTIFICATE_FILES } from '@front-burner/server-core-security/testing';
import { readFileSync } from 'node:fs';
import { OAuth2Server } from 'oauth2-mock-server';

export interface MockOidcProviderOptions {
  /** A fixed port, for example to start the provider again where it was. Free by default. */
  port?: number;
}

/** An OIDC provider for specs and end-to-end tests, over HTTPS with the test certificate. */
export interface MockOidcProvider {
  /** `https://localhost:<port>`, the issuer of the discovery document. */
  issuer: string;
  port: number;
  /** The certificate to trust (PEM). */
  ca: string;
  /** Claims added to (or replacing) those of every token from now on, such as `sub`, `email` or `nonce`. */
  setClaims(claims: Record<string, unknown>): void;
  /** The next authorization redirects back with this error instead of a code. */
  failAuthorization(error: string, description?: string): void;
  /** The next token request answers this status with `invalid_grant`. */
  failTokenRequest(status: number): void;
  stop(): Promise<void>;
}

export const MOCK_OIDC_DEFAULT_CLAIMS = {
  sub: 'subject-1',
  email: 'admin@example.com',
  email_verified: true,
  name: 'Ada Admin'
} as const;

export async function startMockOidcProvider(options: MockOidcProviderOptions = {}): Promise<MockOidcProvider> {
  const server = new OAuth2Server(TEST_CERTIFICATE_FILES.key, TEST_CERTIFICATE_FILES.cert);
  await server.issuer.keys.generate('RS256');

  let claims: Record<string, unknown> = { ...MOCK_OIDC_DEFAULT_CLAIMS };
  let authorizationError: { error: string; description?: string; } | undefined;
  let tokenStatus: number | undefined;

  server.service.on('beforeTokenSigning', (token: { payload: Record<string, unknown>; }) => {
    Object.assign(token.payload, claims);
  });
  server.service.on('beforeAuthorizeRedirect', (redirect: { url: URL; }) => {
    if (authorizationError) {
      redirect.url.searchParams.delete('code');
      redirect.url.searchParams.set('error', authorizationError.error);
      if (authorizationError.description !== undefined) {
        redirect.url.searchParams.set('error_description', authorizationError.description);
      }
      authorizationError = undefined;
    }
  });
  server.service.on('beforeResponse', (response: { statusCode: number; body: unknown; }) => {
    if (tokenStatus !== undefined) {
      response.statusCode = tokenStatus;
      response.body = { error: 'invalid_grant', error_description: 'The code is not valid.' };
      tokenStatus = undefined;
    }
  });

  await server.start(options.port ?? 0, 'localhost');
  const port = server.address().port;
  return {
    issuer: `https://localhost:${port}`,
    port,
    ca: readFileSync(TEST_CERTIFICATE_FILES.cert, 'utf8'),
    setClaims: next => {
      claims = { ...claims, ...next };
    },
    failAuthorization: (error, description) => {
      authorizationError = { error, description };
    },
    failTokenRequest: status => {
      tokenStatus = status;
    },
    stop: () => server.stop()
  };
}
