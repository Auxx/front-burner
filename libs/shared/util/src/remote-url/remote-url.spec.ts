import { defaultRepositoryName, ParsedRemote, parseRemoteUrl, remoteDisplay, remoteKey } from './remote-url';

function parsed(input: string): ParsedRemote {
  const result = parseRemoteUrl(input);
  if (!result.ok) {
    throw new Error(`${input} did not parse: ${result.problem}`);
  }
  return result.remote;
}

function problemOf(input: string) {
  const result = parseRemoteUrl(input);
  return result.ok ? undefined : result.problem;
}

describe('parseRemoteUrl', () => {
  it('accepts HTTPS and SSH forms', () => {
    expect(parsed('https://github.com/acme/handbook.git')).toEqual({
      protocol: 'https',
      host: 'github.com',
      port: undefined,
      user: undefined,
      path: 'acme/handbook.git'
    });
    expect(parsed('https://git.example.com:8443/x/y')).toEqual({
      protocol: 'https',
      host: 'git.example.com',
      port: 8443,
      user: undefined,
      path: 'x/y'
    });
    expect(parsed('ssh://git@host:2222/srv/x.git')).toEqual({
      protocol: 'ssh',
      host: 'host',
      port: 2222,
      user: 'git',
      path: 'srv/x.git'
    });
    expect(parsed('git@github.com:acme/handbook.git')).toEqual({
      protocol: 'ssh',
      host: 'github.com',
      port: undefined,
      user: 'git',
      path: 'acme/handbook.git'
    });
    expect(parsed('host:repo')).toEqual({
      protocol: 'ssh',
      host: 'host',
      port: undefined,
      user: undefined,
      path: 'repo'
    });
    expect(parsed('git@[::1]:x.git')).toEqual({
      protocol: 'ssh',
      host: '::1',
      port: undefined,
      user: 'git',
      path: 'x.git'
    });
    expect(parsed('  https://h/x  ')).toMatchObject({ protocol: 'https', host: 'h', path: 'x' });
  });

  it('refuses other schemes', () => {
    for (const input of [ 'http://h/x', 'git://h/x', 'file:///x', 'ftp://h/x' ]) {
      expect(problemOf(input)).toBe('unsupported');
    }
  });

  it('refuses local paths', () => {
    for (const input of [ '/srv/x.git', './x', '../x', '~/x', 'C:\\repos\\x', 'C:x', 'x' ]) {
      expect(problemOf(input)).toBe('unsupported');
    }
  });

  it('refuses credentials', () => {
    for (const input of [ 'https://u:t@h/x', 'https://u@h/x', 'ssh://u:p@h/x' ]) {
      expect(problemOf(input)).toBe('credentials-in-url');
    }
  });

  it('refuses a query or a fragment', () => {
    for (const input of [ 'https://h/x?a=1', 'https://h/x#top', 'ssh://h/x?a=1' ]) {
      expect(problemOf(input)).toBe('query-or-fragment');
    }
  });

  it('refuses an empty path', () => {
    for (const input of [ 'https://h/', 'https://h', 'ssh://h/', 'git@h:' ]) {
      expect(problemOf(input)).toBe('empty-path');
    }
  });

  it('refuses a missing URL', () => {
    expect(problemOf('')).toBe('required');
    expect(problemOf('   ')).toBe('required');
  });

  it('refuses a URL over 2048 characters', () => {
    const base = 'https://h/';
    expect(parseRemoteUrl(base + 'x'.repeat(2048 - base.length)).ok).toBe(true);
    expect(problemOf(base + 'x'.repeat(2049 - base.length))).toBe('too-long');
  });
});

describe('remoteKey', () => {
  it('gives one key for every form of a remote', () => {
    for (
      const input of [
        'https://github.com/acme/handbook.git',
        'git@github.com:acme/handbook.git',
        'ssh://git@GitHub.com:22/acme/handbook/'
      ]
    ) {
      expect(remoteKey(parsed(input))).toBe('github.com/acme/handbook');
    }
  });

  it('drops a leading / or ~/ of the path', () => {
    expect(remoteKey(parsed('git@h:/srv/x.git'))).toBe('h/srv/x');
    expect(remoteKey(parsed('git@h:~/x.git'))).toBe('h/x');
  });
});

describe('remoteDisplay', () => {
  it('drops credentials from the display form', () => {
    expect(remoteDisplay('https://u:t@github.com/acme/handbook.git')).toBe('github.com/acme/handbook');
    expect(remoteDisplay('https://u:t@h')).toBe('https://h');
    expect(remoteDisplay('ssh://git:p@github.com/acme/handbook.git')).toBe('github.com/acme/handbook');
    expect(remoteDisplay('ssh://git@github.com/acme/handbook.git')).toBe('github.com/acme/handbook');
  });
});

describe('defaultRepositoryName', () => {
  it('names the repository after the last segment', () => {
    expect(defaultRepositoryName(parsed('https://github.com/acme/handbook.git'))).toBe('handbook');
    expect(defaultRepositoryName(parsed('ssh://git@h/acme/handbook/'))).toBe('handbook');
    expect(defaultRepositoryName(parsed('host:repo'))).toBe('repo');
  });
});
