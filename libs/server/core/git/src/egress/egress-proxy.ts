import {
  constantTimeEquals,
  EgressOptions,
  EgressRefusedError,
  Lookup,
  resolveAllowed
} from '@front-burner/server-core-security';
import type { LookupAddress } from 'node:dns';
import { connect, createServer, Socket } from 'node:net';

/** A connection the proxy did not make (AR-57, A-5.8). */
export interface EgressRefusal {
  host: string;
  reason: 'invalid-host' | 'not-found' | 'blocked' | 'unreachable';
}

export interface EgressProxy {
  /** Every refused connection, in order; the engine tells egress refusals from other failures with it. */
  refusals: EgressRefusal[];
  close(): Promise<void>;
}

export interface EgressProxyOptions {
  socketPath: string;
  /** The command's one-time token, the SOCKS5 password. */
  token: string;
  egress: EgressOptions;
  lookup?: Lookup;
  /** Per address. Default 15 seconds. */
  connectTimeoutMs?: number;
}

const SOCKS_VERSION = 5;
const METHOD_USERNAME_PASSWORD = 2;
const NO_ACCEPTABLE_METHOD = 0xff;
const AUTH_VERSION = 1;
const COMMAND_CONNECT = 1;
const ADDRESS_IPV4 = 1;
const ADDRESS_NAME = 3;
const ADDRESS_IPV6 = 4;
const USER = 'fb';
// A handshake never needs more; anything longer is not git.
const MAX_HANDSHAKE_BYTES = 1024;

const REPLY = {
  succeeded: 0,
  notAllowed: 2,
  hostUnreachable: 4,
  commandNotSupported: 7,
  addressTypeNotSupported: 8
} as const;

const REFUSAL_REPLIES: Record<EgressRefusal['reason'], number> = {
  'invalid-host': REPLY.notAllowed,
  blocked: REPLY.notAllowed,
  'not-found': REPLY.hostUnreachable,
  unreachable: REPLY.hostUnreachable
};

const reply = (code: number) => Buffer.from([ SOCKS_VERSION, code, 0, ADDRESS_IPV4, 0, 0, 0, 0, 0, 0 ]);

function ipv6(bytes: Buffer): string {
  const words: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    words.push(bytes.readUInt16BE(i).toString(16));
  }
  return words.join(':');
}

type Step<T> = { value: T; rest: Buffer; } | 'incomplete' | 'invalid';

/** The client's methods; `true` when it offers username/password authentication. */
function readGreeting(buffer: Buffer): Step<boolean> {
  if (buffer.length < 2) {
    return 'incomplete';
  }
  if (buffer[0] !== SOCKS_VERSION) {
    return 'invalid';
  }
  const end = 2 + (buffer[1] ?? 0);
  if (buffer.length < end) {
    return 'incomplete';
  }
  return { value: buffer.subarray(2, end).includes(METHOD_USERNAME_PASSWORD), rest: buffer.subarray(end) };
}

/** RFC 1929: the username and the password. */
function readCredentials(buffer: Buffer): Step<{ user: string; password: string; }> {
  if (buffer.length < 2) {
    return 'incomplete';
  }
  if (buffer[0] !== AUTH_VERSION) {
    return 'invalid';
  }
  const userEnd = 2 + (buffer[1] ?? 0);
  if (buffer.length < userEnd + 1) {
    return 'incomplete';
  }
  const passwordEnd = userEnd + 1 + (buffer[userEnd] ?? 0);
  if (buffer.length < passwordEnd) {
    return 'incomplete';
  }
  return {
    value: {
      user: buffer.subarray(2, userEnd).toString('utf8'),
      password: buffer.subarray(userEnd + 1, passwordEnd).toString('utf8')
    },
    rest: buffer.subarray(passwordEnd)
  };
}

type Request = { command: number; host: string; port: number; } | { addressType: number; };

function readRequest(buffer: Buffer): Step<Request> {
  if (buffer.length < 5) {
    return 'incomplete';
  }
  if (buffer[0] !== SOCKS_VERSION) {
    return 'invalid';
  }
  const command = buffer[1] ?? 0;
  const addressType = buffer[3];
  let start = 4;
  let end: number;
  if (addressType === ADDRESS_IPV4) {
    end = start + 4;
  } else if (addressType === ADDRESS_IPV6) {
    end = start + 16;
  } else if (addressType === ADDRESS_NAME) {
    start = 5;
    end = start + (buffer[4] ?? 0);
  } else {
    return { value: { addressType: addressType ?? 0 }, rest: Buffer.alloc(0) };
  }
  if (buffer.length < end + 2) {
    return 'incomplete';
  }
  const address = buffer.subarray(start, end);
  const host = addressType === ADDRESS_IPV4
    ? [ ...address ].join('.')
    : addressType === ADDRESS_IPV6
    ? ipv6(address)
    : address.toString('latin1');
  return { value: { command, host, port: buffer.readUInt16BE(end) }, rest: buffer.subarray(end + 2) };
}

function connectTo(address: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: address, port, timeout: timeoutMs });
    socket.once('timeout', () => socket.destroy(new Error('timeout')));
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.removeListener('error', reject);
      socket.setTimeout(0);
      resolve(socket);
    });
  });
}

/**
 * Opens the egress proxy of one git command (A-5.7, A-5.8): SOCKS5 on a Unix
 * socket, username `fb` with the command's token as the password, `CONNECT`
 * only. Every connection resolves its host, checks every address, and connects
 * only to the addresses it checked, one after the other.
 */
export async function openEgressProxy(options: EgressProxyOptions): Promise<EgressProxy> {
  const connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
  const refusals: EgressRefusal[] = [];
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  };

  const tunnel = async (client: Socket, host: string, port: number, rest: Buffer) => {
    const refuse = (reason: EgressRefusal['reason']) => {
      refusals.push({ host, reason });
      client.end(reply(REFUSAL_REPLIES[reason]));
    };
    let addresses: LookupAddress[];
    try {
      addresses = await resolveAllowed(host, options.egress, options.lookup);
    } catch (error) {
      if (error instanceof EgressRefusedError) {
        return refuse(error.reason);
      }
      throw error;
    }
    let upstream: Socket | undefined;
    for (const { address } of addresses) {
      try {
        upstream = await connectTo(address, port, connectTimeoutMs);
        break;
      } catch {
        // Try the next checked address.
      }
    }
    if (!upstream) {
      return refuse('unreachable');
    }
    if (client.destroyed) {
      upstream.destroy();
      return;
    }
    track(upstream);
    // Without it, an SSH session took 78 ms longer (A-5.7).
    upstream.setNoDelay(true);
    client.write(reply(REPLY.succeeded));
    if (rest.length > 0) {
      upstream.write(rest);
    }
    client.pipe(upstream).pipe(client);
    upstream.on('close', () => client.destroy());
    client.on('close', () => upstream.destroy());
  };

  const server = createServer(client => {
    track(client);
    let buffer: Buffer = Buffer.alloc(0);
    let state: 'greeting' | 'auth' | 'request' = 'greeting';

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([ buffer, chunk ]);
      if (buffer.length > MAX_HANDSHAKE_BYTES) {
        client.destroy();
        return;
      }
      for (;;) {
        if (state === 'greeting') {
          const step = readGreeting(buffer);
          if (step === 'incomplete') {
            return;
          }
          if (step === 'invalid' || !step.value) {
            client.end(Buffer.from([ SOCKS_VERSION, NO_ACCEPTABLE_METHOD ]));
            return;
          }
          client.write(Buffer.from([ SOCKS_VERSION, METHOD_USERNAME_PASSWORD ]));
          buffer = step.rest;
          state = 'auth';
        } else if (state === 'auth') {
          const step = readCredentials(buffer);
          if (step === 'incomplete') {
            return;
          }
          if (
            step === 'invalid' || step.value.user !== USER || !constantTimeEquals(step.value.password, options.token)
          ) {
            client.end(Buffer.from([ AUTH_VERSION, 1 ]));
            return;
          }
          client.write(Buffer.from([ AUTH_VERSION, 0 ]));
          buffer = step.rest;
          state = 'request';
        } else {
          const step = readRequest(buffer);
          if (step === 'incomplete') {
            return;
          }
          if (step === 'invalid') {
            client.destroy();
            return;
          }
          // Paused until the tunnel's pipe resumes it, so nothing is lost while the host resolves.
          client.removeListener('data', onData);
          client.pause();
          const request = step.value;
          if (!('command' in request)) {
            client.end(reply(REPLY.addressTypeNotSupported));
          } else if (request.command !== COMMAND_CONNECT) {
            client.end(reply(REPLY.commandNotSupported));
          } else {
            // Bytes after the request already belong to the remote host.
            void tunnel(client, request.host, request.port, step.rest).catch(() => client.destroy());
          }
          return;
        }
      }
    };
    client.on('data', onData);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.socketPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  return {
    refusals,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  };
}
