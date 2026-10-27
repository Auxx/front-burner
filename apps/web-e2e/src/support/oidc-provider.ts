import { workspaceRoot } from '@nx/devkit';
import { join } from 'node:path';
import { OAuth2Server } from 'oauth2-mock-server';

const FIXTURES = join(workspaceRoot, 'libs/server/core/security/src/testing/fixtures');

/** The test certificate the provider serves, for the instance's `NODE_EXTRA_CA_CERTS`. */
export const TEST_CERTIFICATE_FILE = join(FIXTURES, 'test.crt');

export interface OidcProvider {
  /** `https://localhost:<port>`. */
  issuer: string;
  stop(): Promise<void>;
}

/** The email every ID token carries; an instance's `FRONT_BURNER_ADMIN_EMAIL` should match it. */
export const OIDC_EMAIL = 'admin@example.com';

/**
 * An OIDC provider that logs anyone in at once as {@link OIDC_EMAIL}, over
 * HTTPS with the test certificate. The server's own specs have a richer one;
 * this project may not import server code (A-2.4).
 */
export async function startOidcProvider(): Promise<OidcProvider> {
  const server = new OAuth2Server(join(FIXTURES, 'test.key'), TEST_CERTIFICATE_FILE);
  await server.issuer.keys.generate('RS256');
  server.service.on('beforeTokenSigning', (token: { payload: Record<string, unknown>; }) => {
    Object.assign(token.payload, { sub: 'web-e2e-subject', email: OIDC_EMAIL, email_verified: true, name: 'Admin' });
  });
  await server.start(0, 'localhost');
  return { issuer: `https://localhost:${server.address().port}`, stop: () => server.stop() };
}
