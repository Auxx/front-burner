import { Database, knownHosts } from '@front-burner/server-core-database';
import {
  BUILT_IN_KNOWN_HOSTS,
  fingerprintOf,
  GitEngine,
  GitOperationError,
  GitOptions,
  GitRunner,
  unlockPrivateKey
} from '@front-burner/server-core-git';
import { GitSshServer, sshKeyFixture, startGitSshServer } from '@front-burner/server-core-git/testing';
import { ApiErrorException } from '@front-burner/server-core-observability';
import type { TrustHostRequest } from '@front-burner/shared-contracts';
import { Logger } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { KnownHostsService } from './known-hosts.service';

const ED25519 = 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
const OTHER = 'AAAAC3NzaC1lZDI1NTE5AAAAIIazEu89wgQZ4bqs3d63QSMzYVa0MuJ2e2gKTKqu+UUO';
const RSA = (BUILT_IN_KNOWN_HOSTS.find(line => line.startsWith('github.com ssh-rsa ')) ?? '').split(' ')[2] ?? '';
const host: TrustHostRequest = { host: 'Git.Example.com', port: 22, type: 'ssh-ed25519', key: ED25519 };

describe('KnownHostsService', () => {
  let database: Database;
  let service: KnownHostsService;
  let alice: number;
  let bob: number;

  beforeEach(() => {
    database = createTestDatabase();
    service = new KnownHostsService(database, { knownHosts: [ `github.com ssh-ed25519 ${OTHER}` ] } as GitOptions);
    alice = insertUser(database, 'alice@x.io');
    bob = insertUser(database, 'bob@x.io');
  });

  afterEach(() => database.sqlite.close());

  it('trusts a host', () => {
    service.trust(alice, host);

    expect(database.db.select().from(knownHosts).all()).toEqual([ {
      id: expect.any(Number),
      userId: alice,
      host: 'git.example.com',
      port: 22,
      keyType: 'ssh-ed25519',
      publicKey: ED25519,
      fingerprint: fingerprintOf(`ssh-ed25519 ${ED25519}`),
      createdAt: expect.any(Date)
    } ]);
  });

  it('writes the user\'s lines', () => {
    service.trust(alice, host);
    service.trust(alice, { ...host, host: 'ssh.example.com', port: 2222 });
    service.trust(bob, { ...host, host: 'bob.example.com' });

    expect(service.linesFor(alice)).toEqual([
      `git.example.com ssh-ed25519 ${ED25519}`,
      `[ssh.example.com]:2222 ssh-ed25519 ${ED25519}`
    ]);
  });

  it('refuses to trust a changed key', () => {
    service.trust(alice, host);

    const changed = () => service.trust(alice, { ...host, key: OTHER });
    expect(changed).toThrow(ApiErrorException);
    expect(changed).toThrow(expect.objectContaining({ code: 'host-key-changed' }));
    expect(service.linesFor(alice)).toEqual([ `git.example.com ssh-ed25519 ${ED25519}` ]);
  });

  it('refuses another key for a host the user already trusts, as ssh would call it changed', () => {
    service.trust(alice, host);
    expect(() => service.trust(alice, { ...host, type: 'ssh-rsa', key: RSA })).toThrow(
      expect.objectContaining({ code: 'host-key-changed' })
    );
  });

  it('refuses to replace an instance-wide key', () => {
    expect(() => service.trust(alice, { ...host, host: 'github.com' })).toThrow(
      expect.objectContaining({ code: 'host-key-changed' })
    );
  });

  it('trusts another port of a host it knows on port 22', () => {
    service.trust(alice, host);
    service.trust(alice, { ...host, port: 2222, key: OTHER });
    expect(service.linesFor(alice)).toEqual([
      `git.example.com ssh-ed25519 ${ED25519}`,
      `[git.example.com]:2222 ssh-ed25519 ${OTHER}`
    ]);
  });

  it('refuses a key whose blob names another type', () => {
    expect(() => service.trust(alice, { ...host, type: 'ssh-rsa' })).toThrow(
      expect.objectContaining({
        code: 'validation-failed',
        fields: [ { path: 'key', code: 'invalid-key', params: {} } ]
      })
    );
    expect(() => service.trust(alice, { ...host, key: 'AAAA' })).toThrow(
      expect.objectContaining({ code: 'validation-failed' })
    );
    expect(service.linesFor(alice)).toEqual([]);
  });

  it('keeps one row when the same key is trusted twice', () => {
    service.trust(alice, host);
    service.trust(alice, { ...host, host: 'git.example.com' });
    expect(database.db.select().from(knownHosts).all()).toHaveLength(1);
  });

  it('keeps users apart', () => {
    service.trust(alice, host);
    service.trust(bob, { ...host, key: OTHER });
    expect(service.linesFor(bob)).toEqual([ `git.example.com ssh-ed25519 ${OTHER}` ]);
  });

  describe('replace', () => {
    it('replaces a user\'s key', () => {
      service.trust(alice, host);
      service.trust(alice, { ...host, port: 2222 });

      service.replace(alice, { ...host, type: 'ssh-rsa', key: RSA });

      expect(service.linesFor(alice)).toEqual([
        `[git.example.com]:2222 ssh-ed25519 ${ED25519}`,
        `git.example.com ssh-rsa ${RSA}`
      ]);
      expect(database.db.select().from(knownHosts).all().at(-1)).toMatchObject({
        host: 'git.example.com',
        keyType: 'ssh-rsa',
        fingerprint: fingerprintOf(`ssh-rsa ${RSA}`)
      });
    });

    it('replaces only a host and port already known', () => {
      service.trust(alice, host);

      const unknown = () => service.replace(alice, { ...host, host: 'new.example.com' });
      expect(unknown).toThrow(expect.objectContaining({ code: 'host-key-not-trusted' }));
      expect(unknown).toThrow(ApiErrorException);
      expect(() => service.replace(alice, { ...host, port: 2200 })).toThrow(
        expect.objectContaining({ code: 'host-key-not-trusted' })
      );
      expect(() => service.replace(alice, { ...host, type: 'ssh-rsa' })).toThrow(
        expect.objectContaining({ code: 'validation-failed' })
      );
      expect(service.linesFor(alice)).toEqual([ `git.example.com ssh-ed25519 ${ED25519}` ]);
    });

    it('replaces only that port', () => {
      service.trust(alice, host);
      service.trust(alice, { ...host, port: 2222 });

      service.replace(alice, { ...host, port: 2222, key: OTHER });

      expect(service.linesFor(alice)).toEqual([
        `git.example.com ssh-ed25519 ${ED25519}`,
        `[git.example.com]:2222 ssh-ed25519 ${OTHER}`
      ]);
    });

    it('does not change another user\'s known hosts', () => {
      service.trust(alice, host);
      service.trust(bob, host);

      service.replace(alice, { ...host, key: OTHER });

      expect(service.linesFor(bob)).toEqual([ `git.example.com ssh-ed25519 ${ED25519}` ]);
    });

    it('adds the user\'s own key next to an instance-wide one, which stays', () => {
      service.replace(alice, { ...host, host: 'github.com', key: ED25519 });

      expect(service.linesFor(alice)).toEqual([ `github.com ssh-ed25519 ${ED25519}` ]);
      expect(service.linesFor(bob)).toEqual([]);
    });

    it('logs the change at info, with both fingerprints', () => {
      const info = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      service.trust(alice, host);

      service.replace(alice, { ...host, key: OTHER });

      expect(info).toHaveBeenCalledWith(
        `User ${alice} replaced the trusted host key of git.example.com port 22: `
          + `${fingerprintOf(`ssh-ed25519 ${ED25519}`)} → ${fingerprintOf(`ssh-ed25519 ${OTHER}`)}`
      );
      expect(JSON.stringify(info.mock.calls)).not.toContain(OTHER);
      info.mockRestore();
    });

    it('logs only the instance\'s key of the type replaced', () => {
      service = new KnownHostsService(database, {
        knownHosts: [ `github.com ssh-ed25519 ${OTHER}`, `github.com ssh-rsa ${RSA}` ]
      } as GitOptions);
      const info = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

      service.replace(alice, { ...host, host: 'github.com', key: ED25519 });

      expect(info).toHaveBeenCalledWith(
        `User ${alice} replaced the trusted host key of github.com port 22: `
          + `${fingerprintOf(`ssh-ed25519 ${OTHER}`)} → ${fingerprintOf(`ssh-ed25519 ${ED25519}`)}`
      );
      info.mockRestore();
    });

    it('does nothing for a key that is already trusted', () => {
      const info = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      service.trust(alice, host);

      service.replace(alice, { ...host, host: 'github.com', key: OTHER });
      service.replace(alice, host);

      expect(service.linesFor(alice)).toEqual([ `git.example.com ssh-ed25519 ${ED25519}` ]);
      expect(info).not.toHaveBeenCalled();
      info.mockRestore();
    });

    it('trust still refuses a changed key', () => {
      service.trust(alice, host);
      service.replace(alice, { ...host, key: OTHER });

      expect(() => service.trust(alice, host)).toThrow(expect.objectContaining({ code: 'host-key-changed' }));
    });

    // The broker listens on a Unix socket in a POSIX path: not on Windows.
    describe.skipIf(process.platform === 'win32')('over SSH', () => {
      const gitEnv = {
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
        HOME: tmpdir(),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.com',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.com'
      };
      const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' });
      let root: string;
      let ssh: GitSshServer;

      beforeEach(async () => {
        root = mkdtempSync(join(tmpdir(), 'known-hosts-'));
        git(root, 'init', '-q', '--bare', '-b', 'main', 'remote.git');
        git(root, 'clone', '-q', join(root, 'remote.git'), 'work');
        git(join(root, 'work'), 'commit', '-q', '--allow-empty', '-m', 'first');
        git(join(root, 'work'), 'push', '-q', 'origin', 'main');
        ssh = await startGitSshServer({
          repositories: { 'remote.git': join(root, 'remote.git') },
          authorizedKeys: [ sshKeyFixture('ed25519.pub') ]
        });
      });

      afterEach(async () => {
        await ssh.close();
        rmSync(root, { recursive: true, force: true });
      });

      it('RC-23: a user\'s new key for a built-in host works, and for that user only', async () => {
        // The instance-wide list holds an old key of this host, as the built-ins would for GitHub.
        const stale = `[${ssh.host}]:${ssh.port} ssh-ed25519 ${OTHER}`;
        const gitOptions: GitOptions = {
          helpersDir: join(__dirname, '..', '..', '..', '..', 'core', 'git', 'helpers'),
          egress: { blockPrivateNetworks: false },
          cloneTimeoutMs: 60_000,
          gitTimeoutMs: 60_000,
          knownHosts: [ stale ]
        };
        service = new KnownHostsService(database, gitOptions);
        const engine = new GitEngine(gitOptions, new GitRunner());
        const remoteUrl = `ssh://git@${ssh.host}:${ssh.port}/remote.git`;
        const work = join(root, 'work');
        git(work, 'remote', 'set-url', 'origin', remoteUrl);
        git(work, 'commit', '-q', '--allow-empty', '-m', 'second');
        const push = (userId: number) =>
          engine.push(work, {
            remoteUrl,
            credentials: { kind: 'ssh', key: unlockPrivateKey(sshKeyFixture('ed25519')) },
            knownHosts: service.linesFor(userId),
            branch: 'main',
            singleBranch: false
          });
        const [ , type, key ] = ssh.hostKeyLine.split(' ');

        service.replace(alice, { host: ssh.host, port: ssh.port, type: 'ssh-ed25519', key: key ?? '' });

        expect(type).toBe('ssh-ed25519');
        await expect(push(alice)).resolves.toEqual({ commits: 1, upstream: 'origin/main' });
        expect(git(join(root, 'remote.git'), 'log', '-1', '--format=%s', 'main').trim()).toBe('second');
        const refused = await push(bob).catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(GitOperationError);
        expect((refused as GitOperationError).code).toBe('host-key-changed');
        expect(gitOptions.knownHosts).toEqual([ stale ]);
      });
    });
  });
});
