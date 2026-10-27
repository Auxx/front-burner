import { readFileSync } from 'node:fs';
import type { RequestListener } from 'node:http';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

const FIXTURES = join(__dirname, 'fixtures');

/** Paths of the test certificate and its key: self-signed for `localhost`, `127.0.0.1` and `::1`, valid until 2036. */
export const TEST_CERTIFICATE_FILES = {
  cert: join(FIXTURES, 'test.crt'),
  key: join(FIXTURES, 'test.key')
} as const;

export interface HttpsTestServer {
  /** `https://127.0.0.1:<port>`, without a trailing slash. */
  url: string;
  /** The certificate to trust: self-signed for `localhost`, `127.0.0.1` and `::1`, valid until 2036. */
  ca: string;
  close(): Promise<void>;
}

/** An HTTPS server on 127.0.0.1 with a test certificate, for specs of outbound connections. */
export async function startHttpsTestServer(handler: RequestListener): Promise<HttpsTestServer> {
  const ca = readFileSync(TEST_CERTIFICATE_FILES.cert, 'utf8');
  const server = createServer({ cert: ca, key: readFileSync(TEST_CERTIFICATE_FILES.key, 'utf8') }, handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `https://127.0.0.1:${port}`,
    ca,
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}
