import { workspaceRoot } from '@nx/devkit';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ParsedKey, Server, utils } from 'ssh2';

// A copy of the server's test SSH server and one of its test keys (web-e2e
// cannot import server libraries, A-2.4).
const FIXTURES = join(workspaceRoot, 'apps/web-e2e/src/support/fixtures');

/** A passphrase-protected Ed25519 test key, in OpenSSH format; its passphrase is {@link PROTECTED_KEY_PASSPHRASE}. */
export const PROTECTED_KEY = readFileSync(join(FIXTURES, 'ed25519-passphrase'), 'utf8');
export const PROTECTED_KEY_PUBLIC = readFileSync(join(FIXTURES, 'ed25519-passphrase.pub'), 'utf8').trim();
export const PROTECTED_KEY_PASSPHRASE = 'correct horse';

export interface GitSshServer {
  port: number;
  /** `ssh://git@127.0.0.1:<port>/<path>`. */
  url(path: string): string;
  /** Listens again on the same port with a new host key, as a server whose key was replaced (RC-21). */
  changeHostKey(): Promise<void>;
  close(): Promise<void>;
}

export interface GitSshServerOptions {
  /** Path in the URL without the leading `/` (such as `repo.git`) → bare repository on disk. */
  repositories: Record<string, string>;
  /** `authorized_keys` lines; only these keys may log in, with a valid signature. */
  authorizedKeys: string[];
}

function parsed(text: string): ParsedKey {
  const key = utils.parseKey(text);
  if (key instanceof Error || Array.isArray(key)) {
    throw new Error('invalid test key');
  }
  return key;
}

/** `git-upload-pack '<path>'` or `git-receive-pack '<path>'` as git sends it over SSH. */
const GIT_COMMAND = /^git-(upload-pack|receive-pack) '\/?([^']+)'$/;

/**
 * An SSH git server on `127.0.0.1` for tests, with a new Ed25519 host key:
 * accepts only the authorized keys and serves `git-upload-pack` and
 * `git-receive-pack` by spawning them.
 */
export async function startGitSshServer(options: GitSshServerOptions): Promise<GitSshServer> {
  let server = gitSshServer(options);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const close = () => new Promise<void>(resolve => server.close(() => resolve()));
  return {
    port,
    url: path => `ssh://git@127.0.0.1:${port}/${path}`,
    changeHostKey: async () => {
      await close();
      server = gitSshServer(options);
      await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    },
    close
  };
}

/**
 * A new Ed25519 private key. `ssh2` writes about one key in 250 in a form it
 * cannot read back ("Malformed OpenSSH private key"), so such a key is
 * replaced.
 */
export function newHostKey(): string {
  for (;;) {
    const key = utils.generateKeyPairSync('ed25519').private;
    if (!(utils.parseKey(key) instanceof Error)) {
      return key;
    }
  }
}

/** The server of {@link startGitSshServer}, with a new host key, not listening yet. */
function gitSshServer(options: GitSshServerOptions): Server {
  const hostKey = newHostKey();
  const authorized = options.authorizedKeys.map(parsed);

  return new Server({ hostKeys: [ hostKey ] }, client => {
    client.on('error', () => undefined);
    client.on('authentication', context => {
      const key = context.method === 'publickey'
        ? authorized.find(candidate => candidate.equals(context.key.data))
        : undefined;
      if (context.method !== 'publickey' || key === undefined) {
        context.reject([ 'publickey' ]);
      } else if (!context.signature || !context.blob) {
        context.accept();
      } else if (key.verify(context.blob, context.signature, context.hashAlgo) === true) {
        context.accept();
      } else {
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
        const match = GIT_COMMAND.exec(info.command);
        const repository = match ? options.repositories[match[2] ?? ''] : undefined;
        if (repository === undefined) {
          stream.stderr.write(`fatal: '${match?.[2] ?? info.command}' does not appear to be a git repository\n`);
          stream.exit(128);
          stream.end();
          return;
        }
        const child = spawn('git', [ match?.[1] ?? 'upload-pack', repository ], {
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
      });
    });
  });
}
