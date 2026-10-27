import { constantTimeEquals, Lookup } from '@front-burner/server-core-security';
import type { ParsedRemote } from '@front-burner/shared-util';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EgressProxy, openEgressProxy } from '../egress/egress-proxy';
import type { GitOptions } from '../git.options';
import { openSshAgent } from '../ssh/ssh-agent';
import type { UnlockedKey } from '../ssh/unlocked-key';

/** What git authenticates with. The secret stays in this process (AR-17, A-5.4). */
export type GitCredentials =
  | { kind: 'none'; }
  | { kind: 'https'; username: string; password: string; }
  | { kind: 'ssh'; key: UnlockedKey; };

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
  /** For SSH: `known_hosts` lines, the instance's and the user's (A-5.6). */
  knownHosts?: string[];
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

/** Paths written into `ssh_config` and `GIT_SSH_COMMAND`: no spaces, quotes, `%` or shell characters. */
function safePath(path: string): string {
  if (!/^[A-Za-z0-9_./+-]+$/.test(path)) {
    throw new Error(`unsupported characters in the path ${JSON.stringify(path)}`);
  }
  return path;
}

/**
 * The per-command `ssh_config` (A-5.4, A-5.7): only our own paths and fixed
 * values. The remote's host and port reach the `ProxyCommand` helper through
 * its environment, never through this file or a shell.
 */
function sshConfig(dir: string, gitOptions: GitOptions, agent: boolean, user: string | undefined): string {
  const lines = [
    'Host *',
    agent ? `IdentityAgent ${dir}/s` : 'IdentityAgent none',
    ...(agent ? [ `IdentityFile ${dir}/id.pub` ] : []),
    'IdentitiesOnly yes',
    'BatchMode yes',
    'StrictHostKeyChecking yes',
    `UserKnownHostsFile ${dir}/known_hosts`,
    'GlobalKnownHostsFile /dev/null',
    'UpdateHostKeys no',
    'HashKnownHosts no',
    'CheckHostIP no',
    'PreferredAuthentications publickey',
    'ForwardAgent no',
    'ForwardX11 no',
    'ClearAllForwardings yes',
    'ControlMaster no',
    'ControlPath none',
    'PermitLocalCommand no',
    `ProxyCommand ${safePath(process.execPath)} ${safePath(gitOptions.helpersDir)}/proxy-connect.cjs`,
    ...(user === undefined ? [ 'User git' ] : [])
  ];
  return lines.map((line, i) => i === 0 ? line : `  ${line}`).join('\n') + '\n';
}

/** `host:port` for the `ProxyCommand` helper. */
function egressTarget({ host, port }: ParsedRemote): string {
  return `${host.includes(':') ? `[${host}]` : host}:${port ?? 22}`;
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
 * the egress proxy, guarded by the command's one-time token, and for HTTPS
 * credentials the askpass server, or for an SSH remote the `ssh_config`, the
 * known hosts and, with a key, the ssh-agent.
 */
export async function openBroker(options: BrokerOptions): Promise<Broker> {
  const { credentials, remote } = options;
  if (credentials.kind !== 'none' && credentials.kind !== remote.protocol) {
    throw new Error(`${credentials.kind} credentials cannot be used with an ${remote.protocol} remote`);
  }
  const dir = safePath(await mkdtemp(join(tmpdir(), 'fb-broker-')));
  await chmod(dir, 0o700);
  const token = randomBytes(32).toString('base64url');
  const sockets = new Set<Socket>();
  const servers: Server[] = [];
  const closers: (() => Promise<void>)[] = [];
  const refusedPrompts: string[] = [];
  let egress: EgressProxy | undefined;

  const close = async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    await Promise.all(closers.map(closer => closer()));
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

    if (remote.protocol === 'ssh') {
      const agent = credentials.kind === 'ssh';
      if (agent) {
        const sshAgent = await openSshAgent({
          socketPath: join(dir, 's'),
          key: credentials.key,
          user: remote.user ?? 'git'
        });
        closers.push(() => sshAgent.close());
        await writeFile(
          join(dir, 'id.pub'),
          `${credentials.key.algorithm} ${credentials.key.publicBlob.toString('base64')}\n`,
          { mode: 0o600 }
        );
      }
      const knownHosts = options.knownHosts ?? [];
      await writeFile(join(dir, 'known_hosts'), knownHosts.map(line => `${line}\n`).join(''), { mode: 0o600 });
      await writeFile(join(dir, 'ssh_config'), sshConfig(dir, options.gitOptions, agent, remote.user), { mode: 0o600 });
      Object.assign(env, {
        GIT_SSH_COMMAND: `ssh -F ${dir}/ssh_config`,
        GIT_SSH_VARIANT: 'ssh',
        FB_EGRESS_SOCK: proxySocket,
        FB_BROKER_TOKEN: token,
        FB_EGRESS_TARGET: egressTarget(remote)
      });
    }

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
