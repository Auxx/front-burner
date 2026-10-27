import { readFileSync } from 'node:fs';

/** A server's host key, as the probe found it or a user accepted it (A-5.6). */
export interface HostKey {
  host: string;
  port: number;
  /** The key type, such as `ssh-ed25519`. */
  type: string;
  /** The public key blob in base64. */
  key: string;
  /** `SHA256:…`, as `ssh-keygen -l` prints it. */
  fingerprint: string;
}

/**
 * The instance's host keys when the operator sets no file (AR-32, A-5.6):
 * GitHub's from `https://api.github.com/meta` and Bitbucket Cloud's from
 * `https://bitbucket.org/site/ssh`, both checked on 2026-10-27.
 */
export const BUILT_IN_KNOWN_HOSTS: readonly string[] = [
  'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
  'github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=',
  'github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=',
  'bitbucket.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIazEu89wgQZ4bqs3d63QSMzYVa0MuJ2e2gKTKqu+UUO',
  'bitbucket.org ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBPIQmuzMBuKdWeF4+a2sjSSpBK0iqitSQ+5BM9KhpexuGt20JpTVM7u5BDZngncgrqDMbWdxMWWOGtZ9UgbqgZE=',
  'bitbucket.org ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDQeJzhupRu0u0cdegZIa8e86EG2qOCsIsD1Xw0xSeiPDlCr7kq97NLmMbpKTX6Esc30NuoqEEHCuc7yWtwp8dI76EEEB1VqY9QJq6vk+aySyboD5QF61I/1WeTwu+deCbgKMGbUijeXhtfbxSxm6JwGrXrhBdofTsbKRUsrN1WoNgUa8uqN1Vx6WAJw1JHPhglEGGHea6QICwJOAr/6mrui/oB7pkaWKHj3z7d1IC4KWLtY47elvjbaTlkN04Kc/5LFEirorGYVbt15kAUlqGM65pk6ZBxtaO3+30LVlORZkxOh+LKL/BvbZ/iRNhItLqNyieoQj/uh/7Iv4uyH/cV/0b4WDSd3DptigWq84lJubb9t/DnZlrJazxyDCulTmKdOR7vs9gMTo+uoIrPSb8ScTtvw65+odKAlBj59dhnVp9zd7QUojOpXlL62Aw56U4oO+FALuevvMjiWeavKhJqlR7i5n9srYcrNV7ttmDw7kf/97P5zauIhxcjX+xHv4M='
];

/**
 * A `known_hosts` line. A port other than 22 is written in brackets, so that
 * trusting `[host]:2222` does not trust port 22 of the same host.
 */
export function knownHostsLine(entry: Pick<HostKey, 'host' | 'port' | 'type' | 'key'>): string {
  const host = entry.port === 22 ? entry.host : `[${entry.host}]:${entry.port}`;
  return `${host} ${entry.type} ${entry.key}`;
}

/**
 * Whether `known_hosts` lines hold any key for a host and port. Like `ssh`, a
 * port without entries of its own falls back to the host's port 22 entries.
 */
export function hasHostEntry(knownHosts: readonly string[], target: { host: string; port: number; }): boolean {
  const names = target.port === 22 ? [ target.host ] : [ `[${target.host}]:${target.port}`, target.host ];
  return knownHosts.some(line => (line.split(/\s+/)[0] ?? '').split(',').some(name => names.includes(name)));
}

/**
 * The instance-wide host keys (AR-32): the operator's
 * `FRONT_BURNER_KNOWN_HOSTS_FILE`, which replaces the built-ins, or the
 * built-ins. Comments and blank lines are dropped.
 *
 * @throws Error at startup, naming the line of a hashed or malformed entry.
 */
export function loadInstanceKnownHosts(
  config: { knownHostsFile: string | undefined; },
  readFile: (path: string) => string = path => readFileSync(path, 'utf8')
): string[] {
  if (config.knownHostsFile === undefined) {
    return [ ...BUILT_IN_KNOWN_HOSTS ];
  }
  let text: string;
  try {
    text = readFile(config.knownHostsFile);
  } catch (error) {
    throw new Error(`FRONT_BURNER_KNOWN_HOSTS_FILE: cannot read ${config.knownHostsFile}: ${(error as Error).message}`);
  }
  const lines: string[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) {
      return;
    }
    const where = `FRONT_BURNER_KNOWN_HOSTS_FILE, line ${index + 1}`;
    if (line.startsWith('|')) {
      throw new Error(`${where}: hashed host names are not supported; write the host name in plain text`);
    }
    if (line.split(/\s+/).length < 3) {
      throw new Error(`${where}: expected "host key-type key"`);
    }
    lines.push(line);
  });
  return lines;
}
