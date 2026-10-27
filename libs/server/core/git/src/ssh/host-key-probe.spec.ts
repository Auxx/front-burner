import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createServer as createTcpServer } from 'node:net';
import { join } from 'node:path';
import { Server } from 'ssh2';
import { GitOperationError } from '../engine/git-errors';
import { probeHostKey } from './host-key-probe';
import { fingerprintOf } from './ssh-keys';

const FIXTURES = join(import.meta.dirname, '../testing/fixtures/keys');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
const ALLOW = { blockPrivateNetworks: false };

async function sshServer(): Promise<{ port: number; logins: number; close(): void; }> {
  const state = { logins: 0 };
  const server = new Server({ hostKeys: [ fixture('ed25519'), fixture('rsa-2048') ] }, client => {
    client.on('error', () => undefined);
    client.on('authentication', context => {
      state.logins++;
      context.reject();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    get logins() {
      return state.logins;
    },
    close: () => server.close()
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(GitOperationError);
    return (error as GitOperationError).code;
  }
  throw new Error('did not throw');
}

describe('probeHostKey', () => {
  it('probes a host key', async () => {
    const server = await sshServer();
    try {
      const hostKey = await probeHostKey({ host: '127.0.0.1', port: server.port }, ALLOW);
      const publicKey = fixture('ed25519.pub').trim();

      expect(hostKey).toEqual({
        host: '127.0.0.1',
        port: server.port,
        type: 'ssh-ed25519',
        key: publicKey.split(' ')[1],
        fingerprint: fingerprintOf(publicKey)
      });
      expect(server.logins).toBe(0);
    } finally {
      server.close();
    }
  });

  it('resolves the host through the lookup', async () => {
    const server = await sshServer();
    try {
      const lookup = vi.fn(async () => [ { address: '127.0.0.1', family: 4 } ]);
      const hostKey = await probeHostKey({ host: 'git.example.com', port: server.port }, ALLOW, lookup);

      expect(hostKey.host).toBe('git.example.com');
      expect(lookup).toHaveBeenCalledWith('git.example.com');
    } finally {
      server.close();
    }
  });

  it('refuses to probe a blocked address', async () => {
    const lookup = vi.fn(async () => [ { address: '169.254.169.254', family: 4 } ]);

    await expect(codeOf(probeHostKey({ host: '127.0.0.1', port: 22 }, { blockPrivateNetworks: true })))
      .resolves.toBe('host-unreachable');
    await expect(codeOf(probeHostKey({ host: 'metadata.example', port: 22 }, ALLOW, lookup)))
      .resolves.toBe('host-unreachable');
  });

  it('reports a host that does not answer SSH as unreachable', async () => {
    const closed = createTcpServer(socket => socket.destroy());
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
    try {
      await expect(codeOf(probeHostKey({ host: '127.0.0.1', port: (closed.address() as AddressInfo).port }, ALLOW)))
        .resolves.toBe('host-unreachable');
    } finally {
      closed.close();
    }
  });
});
