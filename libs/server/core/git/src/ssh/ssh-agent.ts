import { createServer, Server, Socket } from 'node:net';
import type { UnlockedKey } from './unlocked-key';
import { sshString, uint32, WireReader } from './wire';

/** Message numbers of the ssh-agent protocol (draft-miller-ssh-agent). */
const SSH_AGENT_FAILURE = 5;
const SSH_AGENTC_REQUEST_IDENTITIES = 11;
const SSH_AGENT_IDENTITIES_ANSWER = 12;
const SSH_AGENTC_SIGN_REQUEST = 13;
const SSH_AGENT_SIGN_RESPONSE = 14;
const SSH_AGENT_RSA_SHA2_256 = 2;
const SSH_AGENT_RSA_SHA2_512 = 4;
/** RFC 4252 section 7. */
const SSH_MSG_USERAUTH_REQUEST = 50;
const LOGIN_METHODS = [ 'publickey', 'publickey-hostbound-v00@openssh.com' ];

/** OpenSSH's own agent limit. */
const MAX_FRAME_BYTES = 256 * 1024;

export interface SshAgentOptions {
  socketPath: string;
  key: UnlockedKey;
  /** The only user the agent signs logins for. */
  user: string;
  /** One command logs in once; ssh may retry. */
  maxSignatures?: number;
}

export interface SshAgent {
  /** Signatures made so far. */
  readonly signatures: number;
  /** Why requests were refused, in order. */
  readonly refusals: string[];
  close(): Promise<void>;
}

/** Why `data` is not a login request for `user` with `blob`, or `undefined` when it is one. */
function loginProblem(data: Buffer, user: string, blob: Buffer): string | undefined {
  try {
    const reader = new WireReader(data);
    reader.string();
    if (reader.byte() !== SSH_MSG_USERAUTH_REQUEST) {
      return 'not a login request';
    }
    if (reader.string().toString() !== user) {
      return 'another user';
    }
    if (reader.string().toString() !== 'ssh-connection') {
      return 'another service';
    }
    const method = reader.string().toString();
    if (!LOGIN_METHODS.includes(method)) {
      return 'another method';
    }
    if (reader.byte() !== 1) {
      return 'no signature flag';
    }
    reader.string();
    if (!reader.string().equals(blob)) {
      return 'another key';
    }
    if (method !== 'publickey') {
      // The server's host key.
      reader.string();
    }
    return reader.done ? undefined : 'trailing data';
  } catch {
    return 'not a login request';
  }
}

/**
 * Serves the ssh-agent protocol for one git command (A-5.4): it lists the one
 * key and signs only SSH logins for `user` with it, at most `maxSignatures`
 * times. Everything else, including extensions such as OpenSSH's
 * `session-bind@openssh.com`, gets `SSH_AGENT_FAILURE`.
 */
export async function openSshAgent(options: SshAgentOptions): Promise<SshAgent> {
  const { key, user } = options;
  const maxSignatures = options.maxSignatures ?? 4;
  const sockets = new Set<Socket>();
  const state = { signatures: 0, refusals: [] as string[] };

  const refuse = (reason: string): Buffer => {
    state.refusals.push(reason);
    return Buffer.from([ SSH_AGENT_FAILURE ]);
  };

  const answer = (request: Buffer): Buffer => {
    const type = request[0];
    if (type === SSH_AGENTC_REQUEST_IDENTITIES) {
      return Buffer.concat([
        Buffer.from([ SSH_AGENT_IDENTITIES_ANSWER ]),
        uint32(1),
        sshString(key.publicBlob),
        sshString('')
      ]);
    }
    if (type !== SSH_AGENTC_SIGN_REQUEST) {
      return refuse(`message ${type}`);
    }
    let blob: Buffer;
    let data: Buffer;
    let flags: number;
    try {
      const reader = new WireReader(request.subarray(1));
      blob = reader.string();
      data = reader.string();
      flags = reader.uint32();
    } catch {
      return refuse('malformed sign request');
    }
    if (!blob.equals(key.publicBlob)) {
      return refuse('another key');
    }
    const problem = loginProblem(data, user, key.publicBlob);
    if (problem !== undefined) {
      return refuse(problem);
    }
    if (state.signatures >= maxSignatures) {
      return refuse('too many signatures');
    }
    state.signatures++;
    const hash = flags & SSH_AGENT_RSA_SHA2_512 ? 'sha512' : flags & SSH_AGENT_RSA_SHA2_256 ? 'sha256' : undefined;
    return Buffer.concat([ Buffer.from([ SSH_AGENT_SIGN_RESPONSE ]), sshString(key.sign(data, hash)) ]);
  };

  const server: Server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([ buffer, chunk ]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (length === 0 || length > MAX_FRAME_BYTES) {
          socket.destroy();
          return;
        }
        if (buffer.length < 4 + length) {
          return;
        }
        const reply = answer(buffer.subarray(4, 4 + length));
        buffer = buffer.subarray(4 + length);
        socket.write(Buffer.concat([ uint32(reply.length), reply ]));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  return {
    get signatures() {
      return state.signatures;
    },
    refusals: state.refusals,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise(resolve => server.close(resolve));
    }
  };
}
