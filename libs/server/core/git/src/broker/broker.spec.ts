import { ParsedRemote, parseRemoteUrl } from '@front-burner/shared-util';
import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { GitOptions } from '../git.options';
import { unlockPrivateKey } from '../ssh/ssh-keys';
import { Broker, GitCredentials, openBroker } from './broker';

const HELPERS_DIR = join(__dirname, '../../helpers');
const GIT_OPTIONS: GitOptions = {
  helpersDir: HELPERS_DIR,
  egress: { blockPrivateNetworks: false },
  cloneTimeoutMs: 60_000,
  gitTimeoutMs: 60_000,
  knownHosts: []
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

describe('openBroker over SSH', () => {
  const KEYS = join(__dirname, '../testing/fixtures/keys');
  const SSH: GitCredentials = { kind: 'ssh', key: unlockPrivateKey(readFileSync(join(KEYS, 'ed25519'), 'utf8')) };
  const HOST_LINE = 'git.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
  let broker: Broker | undefined;

  const remoteOf = (url: string): ParsedRemote => {
    const parsed = parseRemoteUrl(url);
    if (!parsed.ok) {
      throw new Error(parsed.problem);
    }
    return parsed.remote;
  };
  const open = async (url: string, credentials: GitCredentials = SSH, knownHosts = [ HOST_LINE ]) => {
    broker = await openBroker({ remote: remoteOf(url), credentials, gitOptions: GIT_OPTIONS, knownHosts });
    return broker;
  };
  const configOf = (opened: Broker) => {
    const path = /^ssh -F (\S+)$/.exec(opened.env['GIT_SSH_COMMAND'] ?? '')?.[1] ?? '';
    return { path, text: readFileSync(path, 'utf8') };
  };

  afterEach(async () => {
    await broker?.close();
    broker = undefined;
  });

  it('writes the ssh config, the public key and the known hosts', async () => {
    const opened = await open('ssh://git.example.com:2222/o/r.git');
    const { path, text } = configOf(opened);
    const dir = dirname(path);

    expect(readdirSync(dir).sort()).toEqual([ 'id.pub', 'known_hosts', 'p', 's', 'ssh_config' ]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, 'known_hosts'), 'utf8')).toBe(`${HOST_LINE}\n`);
    expect(readFileSync(join(dir, 'id.pub'), 'utf8').trim()).toBe(
      readFileSync(join(KEYS, 'ed25519.pub'), 'utf8').trim()
    );
    for (
      const setting of [
        `IdentityAgent ${dir}/s`,
        `IdentityFile ${dir}/id.pub`,
        'IdentitiesOnly yes',
        'BatchMode yes',
        'StrictHostKeyChecking yes',
        `UserKnownHostsFile ${dir}/known_hosts`,
        'GlobalKnownHostsFile /dev/null',
        'UpdateHostKeys no',
        'PreferredAuthentications publickey',
        'ForwardAgent no',
        'ControlMaster no',
        'PermitLocalCommand no',
        `ProxyCommand ${process.execPath} ${HELPERS_DIR}/proxy-connect.cjs`,
        'User git'
      ]
    ) {
      expect(text.split('\n').map(line => line.trim())).toContain(setting);
    }
    expect(opened.env).toMatchObject({
      GIT_SSH_VARIANT: 'ssh',
      FB_EGRESS_SOCK: join(dir, 'p'),
      FB_EGRESS_TARGET: 'git.example.com:2222'
    });
    expect(opened.env['FB_BROKER_TOKEN']).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('targets port 22 for the scp-like form', async () => {
    const opened = await open('git@example.com:x.git');

    expect(opened.env['FB_EGRESS_TARGET']).toBe('example.com:22');
    expect(configOf(opened).text).not.toMatch(/^\s*User /m);
  });

  it('serves the key on the agent socket', async () => {
    const opened = await open('git@example.com:x.git');
    const socket = join(dirname(configOf(opened).path), 's');

    const { stdout } = await promisify(execFile)('ssh-add', [ '-L' ], { env: { SSH_AUTH_SOCK: socket } });

    expect(stdout.trim()).toBe(readFileSync(join(KEYS, 'ed25519.pub'), 'utf8').trim());
  });

  it('runs ssh without an agent and without credentials', async () => {
    const opened = await open('git@example.com:x.git', { kind: 'none' });
    const { path, text } = configOf(opened);

    expect(readdirSync(dirname(path)).sort()).toEqual([ 'known_hosts', 'p', 'ssh_config' ]);
    expect(text).toMatch(/^\s*IdentityAgent none$/m);
  });

  it('writes no remote value into the ssh config', async () => {
    const opened = await open('ssh://evil-host.example:2222/x;$(touch pwned)');
    const { text } = configOf(opened);

    expect(text).not.toContain('evil');
    expect(text).not.toContain('2222');
    expect(text).not.toContain('touch');
    expect(opened.env['GIT_SSH_COMMAND']).not.toContain('evil');
  });

  it('refuses HTTPS credentials for an SSH remote', async () => {
    await expect(open('git@example.com:x.git', HTTPS)).rejects.toThrow();
  });
});
