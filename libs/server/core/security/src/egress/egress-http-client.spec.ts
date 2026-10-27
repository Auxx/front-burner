import type { RequestListener } from 'node:http';
import { HttpsTestServer, startHttpsTestServer } from '../testing';
import { EgressRefusedError } from './address-policy';
import { EgressHttpClient } from './egress-http-client';

async function refusalOf(promise: Promise<unknown>): Promise<EgressRefusedError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(EgressRefusedError);
    return error as EgressRefusedError;
  }
  throw new Error('the promise did not reject');
}

describe('EgressHttpClient', () => {
  let server: HttpsTestServer | undefined;

  const serve = async (handler: RequestListener) => {
    server = await startHttpsTestServer(handler);
    return server;
  };
  const clientFor = (blockPrivateNetworks: boolean, { ca }: HttpsTestServer) =>
    new EgressHttpClient({ blockPrivateNetworks }, { ca });

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('fetches from an allowed address', async () => {
    const { url, ca } = await serve((_request, response) => response.end('hello'));

    const response = await new EgressHttpClient({ blockPrivateNetworks: false }, { ca }).fetch(`${url}/x`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello');
  });

  it('refuses loopback with the switch', async () => {
    let requests = 0;
    const running = await serve((_request, response) => {
      requests++;
      response.end();
    });

    const refusal = await refusalOf(clientFor(true, running).fetch(`${running.url}/x`));

    expect(refusal.reason).toBe('blocked');
    expect(requests).toBe(0);
  });

  it('refuses a name that resolves to loopback with the switch', async () => {
    const running = await serve((_request, response) => response.end());

    const port = new URL(running.url).port;
    const refusal = await refusalOf(clientFor(true, running).fetch(`https://localhost:${port}/x`));

    expect(refusal.reason).toBe('blocked');
    expect(refusal.host).toBe('localhost');
  });

  it('refuses plain HTTP', async () => {
    const refusal = await refusalOf(
      new EgressHttpClient({ blockPrivateNetworks: false }).fetch('http://127.0.0.1:8080/x')
    );
    expect(refusal.reason).toBe('blocked');
  });

  it('refuses a redirect to a blocked address', async () => {
    const running = await serve((_request, response) => {
      response.writeHead(302, { location: 'https://169.254.169.254/latest/meta-data/' }).end();
    });

    const refusal = await refusalOf(clientFor(false, running).fetch(`${running.url}/x`));

    expect(refusal.reason).toBe('blocked');
    expect(refusal.host).toBe('169.254.169.254');
  });

  it('refuses a redirect to plain HTTP', async () => {
    const running = await serve((_request, response) => {
      response.writeHead(302, { location: 'http://127.0.0.1:8080/x' }).end();
    });

    expect((await refusalOf(clientFor(false, running).fetch(`${running.url}/x`))).reason).toBe('blocked');
  });

  it('times out', async () => {
    const running = await serve(() => undefined);

    const failure = await clientFor(false, running).fetch(`${running.url}/x`, { timeoutMs: 200 }).catch(
      (error: unknown) => error
    );

    expect(failure).toMatchObject({ name: 'TimeoutError' });
  });
});
