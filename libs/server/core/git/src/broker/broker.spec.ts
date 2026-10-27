import type { ParsedRemote } from '@front-burner/shared-util';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { GitOptions } from '../git.options';
import { Broker, GitCredentials, openBroker } from './broker';

const HELPERS_DIR = join(__dirname, '../../helpers');
const GIT_OPTIONS: GitOptions = {
  helpersDir: HELPERS_DIR,
  egress: { blockPrivateNetworks: false },
  cloneTimeoutMs: 60_000,
  gitTimeoutMs: 60_000
};
const REMOTE: ParsedRemote = {
  protocol: 'https',
  host: 'git.example.com',
  port: undefined,
  user: undefined,
  path: 'o/r.git'
};
const HTTPS: GitCredentials = { kind: 'https', username: 'me@corp', password: 'the-secret-token' };

/** Runs the askpass helper as git does: the prompt as its only argument. */
function askpass(env: Record<string, string>, prompt: string): Promise<{ code: number | null; stdout: string; }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [ join(HELPERS_DIR, 'askpass.cjs'), prompt ], { env });
    let stdout = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    child.on('close', code => resolve({ code, stdout }));
  });
}

const helperEnv = (broker: Broker) => ({
  FB_BROKER_SOCK: broker.env['FB_BROKER_SOCK'] ?? '',
  FB_BROKER_TOKEN: broker.env['FB_BROKER_TOKEN'] ?? ''
});

describe('openBroker', () => {
  let broker: Broker | undefined;

  const open = async (credentials: GitCredentials = HTTPS, remote: ParsedRemote = REMOTE) => {
    broker = await openBroker({ remote, credentials, gitOptions: GIT_OPTIONS });
    return broker;
  };

  afterEach(async () => {
    await broker?.close();
    broker = undefined;
  });

  it('creates a private directory and removes it', async () => {
    const opened = await open();
    const dir = dirname(opened.env['FB_BROKER_SOCK'] ?? '');

    expect(dir).toMatch(/\/fb-broker-[^/]+$/);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readdirSync(dir).sort()).toEqual([ 'a', 'p' ]);

    await opened.close();
    broker = undefined;

    expect(existsSync(dir)).toBe(false);
  });

  it('sends git through the egress proxy, with the token off the command line', async () => {
    const opened = await open({ kind: 'none' });

    expect(opened.env['GIT_CONFIG_COUNT']).toBe('1');
    expect(opened.env['GIT_CONFIG_KEY_0']).toBe('http.proxy');
    expect(opened.env['GIT_CONFIG_VALUE_0']).toMatch(
      /^socks5h:\/\/fb:[A-Za-z0-9_-]{43}@localhost\/.+\/fb-broker-[^/]+\/p$/
    );
    expect(opened.env['GIT_ASKPASS']).toBeUndefined();
    expect(Object.values(opened.env).join('\n')).not.toContain('the-secret-token');
  });

  it('answers git\'s prompts', async () => {
    const opened = await open();

    expect(opened.env['GIT_ASKPASS']).toBe(join(HELPERS_DIR, 'askpass.cjs'));
    const username = await askpass(helperEnv(opened), 'Username for \'https://git.example.com\': ');
    const password = await askpass(helperEnv(opened), 'Password for \'https://me%40corp@git.example.com\': ');

    expect(username).toEqual({ code: 0, stdout: 'me@corp\n' });
    expect(password).toEqual({ code: 0, stdout: 'the-secret-token\n' });
    expect(Object.values(opened.env).join('\n')).not.toContain('the-secret-token');
  });

  it('answers prompts for the port of the remote', async () => {
    const opened = await open(HTTPS, { ...REMOTE, host: '::1', port: 8443 });

    const username = await askpass(helperEnv(opened), 'Username for \'https://[::1]:8443\': ');

    expect(username.stdout).toBe('me@corp\n');
  });

  it('answers prompts only for the expected host', async () => {
    const opened = await open();

    const prompts = [
      'Username for \'https://evil.example.com\': ',
      'Password for \'https://me%40corp@evil.example.com\': ',
      'Username for \'https://git.example.com:8443\': ',
      'Password for \'https://someone-else@git.example.com\': '
    ];
    for (const prompt of prompts) {
      expect(await askpass(helperEnv(opened), prompt)).toEqual({ code: 1, stdout: '' });
    }
    expect(opened.refusedPrompts).toEqual(prompts);
  });

  it('refuses any other prompt', async () => {
    const opened = await open();

    expect(await askpass(helperEnv(opened), 'Enter passphrase for key: ')).toEqual({ code: 1, stdout: '' });
  });

  it('refuses a forged token', async () => {
    const opened = await open();

    const result = await askpass(
      { ...helperEnv(opened), FB_BROKER_TOKEN: 'forged' },
      'Password for \'https://me%40corp@git.example.com\': '
    );

    expect(result).toEqual({ code: 1, stdout: '' });
  });

  it('answers at most 4 prompts', async () => {
    const opened = await open();

    const answers: string[] = [];
    for (let i = 0; i < 5; i++) {
      answers.push((await askpass(helperEnv(opened), 'Username for \'https://git.example.com\': ')).stdout);
    }

    expect(answers).toEqual([ 'me@corp\n', 'me@corp\n', 'me@corp\n', 'me@corp\n', '' ]);
  });
});
