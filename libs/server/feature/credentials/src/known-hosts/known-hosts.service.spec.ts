import { Database, knownHosts } from '@front-burner/server-core-database';
import { BUILT_IN_KNOWN_HOSTS, fingerprintOf, GitOptions } from '@front-burner/server-core-git';
import { ApiErrorException } from '@front-burner/server-core-observability';
import { insertUser } from '../testing/fixtures';
import { createTestDatabase } from '../testing/test-database';
import { KnownHostsService } from './known-hosts.service';

const ED25519 = 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
const OTHER = 'AAAAC3NzaC1lZDI1NTE5AAAAIIazEu89wgQZ4bqs3d63QSMzYVa0MuJ2e2gKTKqu+UUO';
const RSA = (BUILT_IN_KNOWN_HOSTS.find(line => line.startsWith('github.com ssh-rsa ')) ?? '').split(' ')[2] ?? '';
const host = { host: 'Git.Example.com', port: 22, type: 'ssh-ed25519', key: ED25519 };

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
});
