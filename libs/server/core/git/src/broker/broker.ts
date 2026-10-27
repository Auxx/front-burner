import { constantTimeEquals, Lookup } from '@front-burner/server-core-security';
import type { ParsedRemote } from '@front-burner/shared-util';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { createServer, Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EgressProxy, openEgressProxy } from '../egress/egress-proxy';
import type { GitOptions } from '../git.options';

/** What git authenticates with. The secret stays in this process (AR-17, A-5.4). */
export type GitCredentials = { kind: 'none'; } | { kind: 'https'; username: string; password: string; };

export interface Broker {
  /** For git's environment: the proxy and, with HTTPS credentials, the askpass helper. Holds no secret. */
  env: Record<string, string>;
  egress: EgressProxy;
  /** Prompts the askpass server refused, in order. */
  refusedPrompts: string[];
  /** Stops the servers and removes the directory. */
  close(): Promise<void>;
}

export interface BrokerOptions {
  remote: ParsedRemote;
  credentials: GitCredentials;
  gitOptions: GitOptions;
  lookup?: Lookup;
}

/** git asks for a username, then a password, and may ask again once after a refusal. */
const MAX_PROMPTS = 4;
const MAX_REQUEST_BYTES = 4096;

/** `host[:port]` as git writes it in its prompts. */
function authority({ host, port }: ParsedRemote): string {
  const name = host.includes(':') ? `[${host}]` : host;
  return port === undefined ? name : `${name}:${port}`;
}

function decode(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

/** The answer to one of git's two prompts for the remote's own host and user, or `undefined` (A-5.4). */
function answerPrompt(prompt: string, remote: ParsedRemote, username: string, password: string): string | undefined {
  const expected = authority(remote);
  if (prompt === `Username for 'https://${expected}': `) {
    return username;
  }
  // git writes the user name percent-encoded.
  const match = /^Password for 'https:\/\/(.+)@([^@]+)': $/.exec(prompt);
  if (match && match[2] === expected && decode(match[1] ?? '') === username) {
    return password;
  }
  return undefined;
}

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

/** Git's config through the environment, so values stay off command lines (A-5.7). */
function configEnv(entries: [ string, string ][]): Record<string, string> {
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(entries.length) };
  entries.forEach(([ key, value ], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return env;
}

/**
 * Opens the broker of one git command (A-5.4, A-5.7): a `0700` directory with
 * the egress proxy and, for HTTPS credentials, the askpass server, both guarded
 * by the command's one-time token.
 */
export async function openBroker(options: BrokerOptions): Promise<Broker> {
  const dir = await mkdtemp(join(tmpdir(), 'fb-broker-'));
  await chmod(dir, 0o700);
  const token = randomBytes(32).toString('base64url');
  const sockets = new Set<Socket>();
  const servers: Server[] = [];
  const refusedPrompts: string[] = [];
  let egress: EgressProxy | undefined;

  const close = async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    await egress?.close();
    await rm(dir, { recursive: true, force: true });
  };

  try {
    const proxySocket = join(dir, 'p');
    egress = await openEgressProxy({
      socketPath: proxySocket,
      token,
      egress: options.gitOptions.egress,
      lookup: options.lookup
    });
    const env = configEnv([ [ 'http.proxy', `socks5h://fb:${token}@localhost${proxySocket}` ] ]);

    const { credentials } = options;
    if (credentials.kind === 'https') {
      const askpassSocket = join(dir, 'a');
      let prompts = 0;
      const server = createServer(socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => socket.destroy());
        let request = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => {
          request += chunk;
          if (request.length > MAX_REQUEST_BYTES) {
            socket.destroy();
            return;
          }
          const end = request.indexOf('\n');
          if (end < 0) {
            return;
          }
          let parsed: { token?: unknown; prompt?: unknown; };
          try {
            parsed = JSON.parse(request.slice(0, end));
          } catch {
            socket.end('no\n');
            return;
          }
          if (typeof parsed.token !== 'string' || !constantTimeEquals(parsed.token, token)) {
            socket.end('no\n');
            return;
          }
          const prompt = String(parsed.prompt);
          const answer = ++prompts > MAX_PROMPTS
            ? undefined
            : answerPrompt(prompt, options.remote, credentials.username, credentials.password);
          if (answer === undefined) {
            refusedPrompts.push(prompt);
            socket.end('no\n');
            return;
          }
          socket.end(`ok ${answer}\n`);
        });
      });
      servers.push(server);
      await listen(server, askpassSocket);
      Object.assign(env, {
        GIT_ASKPASS: join(options.gitOptions.helpersDir, 'askpass.cjs'),
        FB_BROKER_SOCK: askpassSocket,
        FB_BROKER_TOKEN: token
      });
    }

    return { env, egress, refusedPrompts, close };
  } catch (error) {
    await close();
    throw error;
  }
}
