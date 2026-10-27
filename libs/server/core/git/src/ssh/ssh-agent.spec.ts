import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { connect, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client, Server, utils } from 'ssh2';
import { openSshAgent, SshAgent } from './ssh-agent';
import { unlockPrivateKey } from './ssh-keys';
import type { UnlockedKey } from './unlocked-key';
import { sshString, uint32 } from './wire';

const FIXTURES = join(import.meta.dirname, '../testing/fixtures/keys');
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

let dir: string;
let agents: SshAgent[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fb-agent-'));
  agents = [];
});

afterEach(async () => {
  await Promise.all(agents.map(agent => agent.close()));
  rmSync(dir, { recursive: true, force: true });
});

async function open(key: UnlockedKey, maxSignatures?: number): Promise<string> {
  const socketPath = join(dir, 's');
  agents.push(await openSshAgent({ socketPath, key, user: 'git', maxSignatures }));
  return socketPath;
}

/** A raw agent connection that sends frames and reads the type of each answer. */
async function rawConnection(socketPath: string): Promise<{ send(body: Buffer): Promise<number>; close(): void; }> {
  const socket: Socket = connect(socketPath);
  await new Promise(resolve => socket.once('connect', resolve));
  let buffer = Buffer.alloc(0);
  const waiting: ((type: number) => void)[] = [];
  socket.on('data', chunk => {
    buffer = Buffer.concat([ buffer, chunk ]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE(0)) {
      const length = buffer.readUInt32BE(0);
      const type = buffer[4] ?? -1;
      buffer = buffer.subarray(4 + length);
      waiting.shift()?.(type);
    }
  });
  return {
    send: body =>
      new Promise(resolve => {
        waiting.push(resolve);
        socket.write(Buffer.concat([ uint32(body.length), body ]));
      }),
    close: () => socket.destroy()
  };
}

/** `SSH_AGENTC_SIGN_REQUEST` for `data` with our key. */
function signRequest(key: UnlockedKey, data: Buffer, flags = 0): Buffer {
  return Buffer.concat([ Buffer.from([ 13 ]), sshString(key.publicBlob), sshString(data), uint32(flags) ]);
}

/** The data of an `SSH_MSG_USERAUTH_REQUEST` signature (RFC 4252 section 7). */
function loginData(key: UnlockedKey, user: string, method = 'publickey'): Buffer {
  return Buffer.concat([
    sshString(Buffer.alloc(32, 7)),
    Buffer.from([ 50 ]),
    sshString(user),
    sshString('ssh-connection'),
    sshString(method),
    Buffer.from([ 1 ]),
    sshString(key.algorithm),
    sshString(key.publicBlob),
    ...(method === 'publickey' ? [] : [ sshString(Buffer.from('host key')) ])
  ]);
}

/** An ssh2 server that accepts `authorized` by checking its signature; resolves with the signature's hash. */
async function loginThroughAgent(socketPath: string, authorized: string): Promise<string | undefined> {
  const hostKey = utils.generateKeyPairSync('ed25519').private;
  const allowed = utils.parseKey(authorized);
  if (allowed instanceof Error || Array.isArray(allowed)) {
    throw new Error('bad key');
  }
  let hash: string | undefined;
  const server = new Server({ hostKeys: [ hostKey ] }, client => {
    client.on('error', () => undefined);
    client.on('authentication', context => {
      if (context.method !== 'publickey' || context.username !== 'git' || !allowed.equals(context.key.data)) {
        context.reject();
      } else if (!context.signature || !context.blob) {
        // The client asks whether the key is acceptable before signing.
        context.accept();
      } else if (allowed.verify(context.blob, context.signature, context.hashAlgo) === true) {
        hash = context.hashAlgo;
        context.accept();
      } else {
        context.reject();
      }
    });
    client.on('ready', () => client.end());
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const client = new Client();
      client.on('ready', () => {
        client.end();
        resolve();
      });
      client.on('error', reject);
      client.connect({ host: '127.0.0.1', port, username: 'git', agent: socketPath, hostVerifier: () => true });
    });
  } finally {
    server.close();
  }
  return hash ?? 'none';
}

describe('openSshAgent', () => {
  it('lists the one identity', async () => {
    const socketPath = await open(unlockPrivateKey(fixture('ed25519')));

    const { stdout } = await promisify(execFile)('ssh-add', [ '-L' ], {
      env: { ...process.env, SSH_AUTH_SOCK: socketPath }
    });

    expect(stdout.trim()).toBe(fixture('ed25519.pub').trim());
  });

  it('signs a login request', async () => {
    const socketPath = await open(unlockPrivateKey(fixture('ed25519')));

    await expect(loginThroughAgent(socketPath, fixture('ed25519.pub'))).resolves.toBeDefined();
    expect(agents[0]?.signatures).toBe(1);
  });

  it('signs ECDSA', async () => {
    const socketPath = await open(unlockPrivateKey(fixture('ecdsa-p256')));

    await expect(loginThroughAgent(socketPath, fixture('ecdsa-p256.pub'))).resolves.toBeDefined();
  });

  it('signs RSA with SHA-256', async () => {
    const socketPath = await open(unlockPrivateKey(fixture('rsa-2048')));

    await expect(loginThroughAgent(socketPath, fixture('rsa-2048.pub'))).resolves.toMatch(/^sha(256|512)$/);
  });

  it('refuses to sign anything but a login request', async () => {
    const key = unlockPrivateKey(fixture('ed25519'));
    const connection = await rawConnection(await open(key));

    await expect(connection.send(signRequest(key, Buffer.from('a commit to sign')))).resolves.toBe(5);
    await expect(connection.send(signRequest(key, loginData(key, 'git', 'password')))).resolves.toBe(5);
    await expect(connection.send(signRequest(key, loginData(key, 'git')))).resolves.toBe(14);
    connection.close();
    expect(agents[0]?.refusals).toHaveLength(2);
  });

  it('accepts the host-bound login method', async () => {
    const key = unlockPrivateKey(fixture('ed25519'));
    const connection = await rawConnection(await open(key));

    await expect(connection.send(signRequest(key, loginData(key, 'git', 'publickey-hostbound-v00@openssh.com'))))
      .resolves.toBe(14);
    connection.close();
  });

  it('refuses another user', async () => {
    const key = unlockPrivateKey(fixture('ed25519'));
    const connection = await rawConnection(await open(key));

    await expect(connection.send(signRequest(key, loginData(key, 'root')))).resolves.toBe(5);
    connection.close();
  });

  it('refuses another key', async () => {
    const key = unlockPrivateKey(fixture('ed25519'));
    const other = unlockPrivateKey(fixture('ecdsa-p256'));
    const connection = await rawConnection(await open(key));

    await expect(connection.send(signRequest(other, loginData(other, 'git')))).resolves.toBe(5);
    connection.close();
  });

  it('stops after the maximum', async () => {
    const key = unlockPrivateKey(fixture('ed25519'));
    const connection = await rawConnection(await open(key, 1));

    await expect(connection.send(signRequest(key, loginData(key, 'git')))).resolves.toBe(14);
    await expect(connection.send(signRequest(key, loginData(key, 'git')))).resolves.toBe(5);
    connection.close();
  });

  it('answers extensions with failure and keeps going', async () => {
    const key = unlockPrivateKey(fixture('ed25519'));
    const connection = await rawConnection(await open(key));
    const sessionBind = Buffer.concat([
      Buffer.from([ 27 ]),
      sshString('session-bind@openssh.com'),
      sshString(key.publicBlob),
      sshString(Buffer.alloc(32)),
      sshString(Buffer.alloc(64)),
      Buffer.from([ 0 ])
    ]);

    await expect(connection.send(sessionBind)).resolves.toBe(5);
    await expect(connection.send(Buffer.from([ 11 ]))).resolves.toBe(12);
    connection.close();
  });

  it('closes the connection on a frame that is too large', async () => {
    const socket = connect(await open(unlockPrivateKey(fixture('ed25519'))));
    await new Promise(resolve => socket.once('connect', resolve));

    const closed = new Promise(resolve => socket.once('close', resolve));
    socket.write(uint32(256 * 1024 + 1));
    await expect(closed).resolves.toBeDefined();
  });
});
