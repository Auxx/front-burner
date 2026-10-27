import { BUILT_IN_KNOWN_HOSTS, hasHostEntry, knownHostsLine, loadInstanceKnownHosts } from './known-hosts';
import { fingerprintOf } from './ssh-keys';

const KEY = 'AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';

describe('knownHostsLine', () => {
  it('writes the standard port without brackets', () => {
    expect(knownHostsLine({ host: 'example.com', port: 22, type: 'ssh-ed25519', key: KEY }))
      .toBe(`example.com ssh-ed25519 ${KEY}`);
  });

  it('writes non-standard ports in brackets', () => {
    expect(knownHostsLine({ host: 'example.com', port: 2222, type: 'ssh-ed25519', key: KEY }))
      .toBe(`[example.com]:2222 ssh-ed25519 ${KEY}`);
    expect(knownHostsLine({ host: '2001:db8::1', port: 2222, type: 'ssh-ed25519', key: KEY }))
      .toBe(`[2001:db8::1]:2222 ssh-ed25519 ${KEY}`);
  });
});

describe('BUILT_IN_KNOWN_HOSTS', () => {
  it('holds the published keys of GitHub and Bitbucket', () => {
    const fingerprints = BUILT_IN_KNOWN_HOSTS.map(line =>
      `${line.split(' ')[0]} ${fingerprintOf(line.split(' ').slice(1).join(' '))}`
    );

    // As published by GitHub and Bitbucket.
    expect(fingerprints).toContain('github.com SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU');
    expect(fingerprints).toContain('github.com SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s');
    expect(fingerprints).toContain('github.com SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM');
    expect(fingerprints).toContain('bitbucket.org SHA256:ybgmFkzwOSotHTHLJgHO0QN8L0xErw6vd0VhFA9m3SM');
    expect(BUILT_IN_KNOWN_HOSTS).toHaveLength(6);
  });
});

describe('loadInstanceKnownHosts', () => {
  it('uses the built-ins without a file', () => {
    expect(loadInstanceKnownHosts({ knownHostsFile: undefined })).toEqual(BUILT_IN_KNOWN_HOSTS);
  });

  it('replaces the built-ins with the operator\'s file', () => {
    const text =
      `# our git server\n\ngit.example.com ssh-ed25519 ${KEY}\n  [git.example.com]:2222 ssh-ed25519 ${KEY}  \n`;
    const readFile = vi.fn(() => text);

    expect(loadInstanceKnownHosts({ knownHostsFile: '/etc/fb/known_hosts' }, readFile)).toEqual([
      `git.example.com ssh-ed25519 ${KEY}`,
      `[git.example.com]:2222 ssh-ed25519 ${KEY}`
    ]);
    expect(readFile).toHaveBeenCalledWith('/etc/fb/known_hosts');
  });

  it('refuses hashed entries', () => {
    const text = `git.example.com ssh-ed25519 ${KEY}\n|1|c2FsdA==|aGFzaA== ssh-ed25519 ${KEY}\n`;

    expect(() => loadInstanceKnownHosts({ knownHostsFile: '/k' }, () => text)).toThrow(/line 2.*hashed/);
  });

  it('refuses lines that are not host keys', () => {
    expect(() => loadInstanceKnownHosts({ knownHostsFile: '/k' }, () => 'git.example.com\n')).toThrow(/line 1/);
  });

  it('names a file it cannot read', () => {
    const readFile = () => {
      throw new Error('ENOENT');
    };

    expect(() => loadInstanceKnownHosts({ knownHostsFile: '/k' }, readFile)).toThrow(/FRONT_BURNER_KNOWN_HOSTS_FILE/);
  });
});

describe('hasHostEntry', () => {
  const lines = [
    'git.example.com ssh-ed25519 AAAA',
    '[other.example.com]:2222 ssh-rsa BBBB',
    'a.io,b.io ssh-rsa CCCC'
  ];

  it('finds a host on port 22', () => {
    expect(hasHostEntry(lines, { host: 'git.example.com', port: 22 })).toBe(true);
    expect(hasHostEntry(lines, { host: 'b.io', port: 22 })).toBe(true);
    expect(hasHostEntry(lines, { host: 'unknown.example.com', port: 22 })).toBe(false);
  });

  it('finds a host on another port only under [host]:port, as ssh does', () => {
    expect(hasHostEntry(lines, { host: 'other.example.com', port: 2222 })).toBe(true);
    expect(hasHostEntry(lines, { host: 'git.example.com', port: 2222 })).toBe(false);
    expect(hasHostEntry(lines, { host: 'other.example.com', port: 22 })).toBe(false);
  });
});
