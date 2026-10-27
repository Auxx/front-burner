import type { Lookup } from '@front-burner/server-core-security';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { AddressInfo, createServer, Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EgressProxy, openEgressProxy } from './egress-proxy';

const HELPER = join(__dirname, '../../helpers/proxy-connect.cjs');
const TOKEN = 'one-time-token-of-the-command';

/** Runs the ssh ProxyCommand helper: sends `input` through the tunnel and returns what came back. */
function connectThrough(
  socketPath: string,
  target: string,
  input: string,
  token = TOKEN
): Promise<{ code: number | null; stdout: string; stderr: string; }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [ HELPER ], {
      env: { FB_EGRESS_SOCK: socketPath, FB_BROKER_TOKEN: token, FB_EGRESS_TARGET: target }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    child.stdin.end(input);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

describe('openEgressProxy', () => {
  let dir: string;
  let socketPath: string;
  let echo: Server;
  let echoPort: number;
  let proxy: EgressProxy | undefined;
  let connections: number;

  const open = async (blockPrivateNetworks: boolean, lookup?: Lookup) => {
    proxy = await openEgressProxy({ socketPath, token: TOKEN, egress: { blockPrivateNetworks }, lookup });
    return proxy;
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fb-egress-spec-'));
    socketPath = join(dir, 'p');
    connections = 0;
    echo = createServer(socket => {
      connections++;
      socket.pipe(socket);
    });
    await new Promise<void>(resolve => echo.listen(0, '127.0.0.1', resolve));
    echoPort = (echo.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await proxy?.close();
    proxy = undefined;
    await new Promise(resolve => echo.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });

  it('relays to an allowed address', async () => {
    const running = await open(false);

    const result = await connectThrough(socketPath, `127.0.0.1:${echoPort}`, 'hello through the proxy');

    expect(result.stdout).toBe('hello through the proxy');
    expect(result.code).toBe(0);
    expect(running.refusals).toEqual([]);
  });

  it('relays the answer after the client has finished sending', async () => {
    // Answers only after the client's end, as a server does to a half-closed connection.
    const late = createServer({ allowHalfOpen: true }, socket => {
      let received = '';
      socket.on('data', chunk => (received += chunk));
      socket.on('end', () => setTimeout(() => socket.end(`late: ${received}`), 100));
    });
    await new Promise<void>(resolve => late.listen(0, '127.0.0.1', resolve));
    try {
      await open(false);

      const result = await connectThrough(socketPath, `127.0.0.1:${(late.address() as AddressInfo).port}`, 'question');

      expect(result.stdout).toBe('late: question');
    } finally {
      await new Promise(resolve => late.close(resolve));
    }
  });

  it('relays to a name it resolves itself', async () => {
    const lookups: string[] = [];
    await open(false, async host => {
      lookups.push(host);
      return [ { address: '127.0.0.1', family: 4 } ];
    });

    const result = await connectThrough(socketPath, `git.example.test:${echoPort}`, 'by name');

    expect(result.stdout).toBe('by name');
    expect(lookups).toEqual([ 'git.example.test' ]);
  });

  it('tries the checked addresses one after the other', async () => {
    await open(false, async () => [ { address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 } ]);

    const result = await connectThrough(socketPath, `git.example.test:${echoPort}`, 'second address');

    expect(result.stdout).toBe('second address');
  });

  it('refuses a wrong token', async () => {
    const running = await open(false);

    const result = await connectThrough(socketPath, `127.0.0.1:${echoPort}`, 'x', 'forged-token');

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(connections).toBe(0);
    expect(running.refusals).toEqual([]);
  });

  it('refuses a blocked address and records it', async () => {
    const running = await open(true);

    const result = await connectThrough(socketPath, `127.0.0.1:${echoPort}`, 'x');

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('egress proxy refused the connection');
    expect(connections).toBe(0);
    expect(running.refusals).toEqual([ { host: '127.0.0.1', reason: 'blocked' } ]);
  });

  it('refuses the metadata address without the switch', async () => {
    const running = await open(false);

    await connectThrough(socketPath, '169.254.169.254:80', 'x');

    expect(running.refusals).toEqual([ { host: '169.254.169.254', reason: 'blocked' } ]);
  });

  it('refuses a name with a blocked address', async () => {
    const running = await open(false, async () => [
      { address: '127.0.0.1', family: 4 },
      { address: '169.254.169.254', family: 4 }
    ]);

    const result = await connectThrough(socketPath, `rebind.example.test:${echoPort}`, 'x');

    expect(result.code).not.toBe(0);
    expect(connections).toBe(0);
    expect(running.refusals).toEqual([ { host: 'rebind.example.test', reason: 'blocked' } ]);
  });

  it('refuses an invalid host name and records a name that is not found', async () => {
    const running = await open(false, async () => {
      throw new Error('ENOTFOUND');
    });

    await connectThrough(socketPath, `bad_host!:${echoPort}`, 'x');
    await connectThrough(socketPath, `missing.example.test:${echoPort}`, 'x');

    expect(running.refusals).toEqual([
      { host: 'bad_host!', reason: 'invalid-host' },
      { host: 'missing.example.test', reason: 'not-found' }
    ]);
  });

  it('records an unreachable host', async () => {
    const closed = createServer();
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise(resolve => closed.close(resolve));
    const running = await open(false);

    const result = await connectThrough(socketPath, `127.0.0.1:${closedPort}`, 'x');

    expect(result.code).not.toBe(0);
    expect(running.refusals).toEqual([ { host: '127.0.0.1', reason: 'unreachable' } ]);
  });

  it('closes the open tunnels and the socket', async () => {
    const running = await open(false);

    await running.close();
    proxy = undefined;
    const result = await connectThrough(socketPath, `127.0.0.1:${echoPort}`, 'x');

    expect(result.code).not.toBe(0);
  });
});
