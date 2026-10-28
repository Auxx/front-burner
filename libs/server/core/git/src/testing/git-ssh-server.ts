import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { ParsedKey, Server, utils } from 'ssh2';
import { generateEd25519Key } from '../ssh/ssh-keys';

export interface GitSshServer {
  host: string;
  port: number;
  /** The server's host key as a `known_hosts` line for `[host]:port`. */
  hostKeyLine: string;
  /** Logins refused, such as a key that is not authorized. */
  readonly refusedLogins: number;
  close(): Promise<void>;
}

export interface GitSshServerOptions {
  /** Path in the URL without the leading `/` (such as `repo.git`) → bare repository on disk. */
  repositories: Record<string, string>;
  /** `authorized_keys` lines; only these keys may log in, with a valid signature. */
  authorizedKeys: string[];
  /** A private key in OpenSSH or PEM format; a new Ed25519 key when omitted. */
  hostKey?: string;
  /** Waits this long before running each command. */
  delayMs?: number;
}

function parsed(text: string): ParsedKey {
  const key = utils.parseKey(text);
  if (key instanceof Error || Array.isArray(key)) {
    throw new Error('invalid test key');
  }
  return key;
}

/** `git-upload-pack '<path>'` as git sends it over SSH. */
const UPLOAD_PACK = /^git-upload-pack '\/?([^']+)'$/;

/**
 * An SSH git server on `127.0.0.1` for tests: accepts only the authorized
 * keys and serves `git-upload-pack` by spawning it.
 */
export async function startGitSshServer(options: GitSshServerOptions): Promise<GitSshServer> {
  const hostKey = options.hostKey ?? generateEd25519Key('host').privateKey;
  const authorized = options.authorizedKeys.map(parsed);
  const state = { refusedLogins: 0 };

  const server = new Server({ hostKeys: [ hostKey ] }, client => {
    client.on('error', () => undefined);
    client.on('authentication', context => {
      const key = context.method === 'publickey'
        ? authorized.find(candidate => candidate.equals(context.key.data))
        : undefined;
      if (context.method !== 'publickey' || key === undefined) {
        state.refusedLogins++;
        context.reject([ 'publickey' ]);
      } else if (!context.signature || !context.blob) {
        context.accept();
      } else if (key.verify(context.blob, context.signature, context.hashAlgo) === true) {
        context.accept();
      } else {
        state.refusedLogins++;
        context.reject([ 'publickey' ]);
      }
    });
    client.on('session', accept => {
      const session = accept();
      const env: Record<string, string> = {};
      session.on('env', (acceptEnv, _reject, info) => {
        if (info.key === 'GIT_PROTOCOL') {
          env['GIT_PROTOCOL'] = info.val;
        }
        acceptEnv?.();
      });
      session.on('exec', (acceptExec, _reject, info) => {
        const stream = acceptExec();
        const match = UPLOAD_PACK.exec(info.command);
        const repository = match ? options.repositories[match[1] ?? ''] : undefined;
        if (repository === undefined) {
          stream.stderr.write(`fatal: '${match?.[1] ?? info.command}' does not appear to be a git repository\n`);
          stream.exit(128);
          stream.end();
          return;
        }
        setTimeout(() => {
          const child = spawn('git', [ 'upload-pack', repository ], {
            env: {
              PATH: process.env['PATH'] ?? '/usr/bin:/bin',
              HOME: tmpdir(),
              GIT_CONFIG_NOSYSTEM: '1',
              GIT_CONFIG_GLOBAL: '/dev/null',
              ...env
            }
          });
          stream.pipe(child.stdin);
          child.stdin.on('error', () => undefined);
          child.stdout.pipe(stream, { end: false });
          child.stderr.pipe(stream.stderr, { end: false });
          child.on('close', code => {
            stream.exit(code ?? 1);
            stream.end();
          });
        }, options.delayMs ?? 0);
      });
    });
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const publicKey = parsed(hostKey).getPublicSSH();
  return {
    host: '127.0.0.1',
    port,
    hostKeyLine: `[127.0.0.1]:${port} ${parsed(hostKey).type} ${publicKey.toString('base64')}`,
    get refusedLogins() {
      return state.refusedLogins;
    },
    close: () => new Promise(resolve => server.close(() => resolve()))
  };
}
