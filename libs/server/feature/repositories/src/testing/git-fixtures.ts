import type { GitOptions } from '@front-burner/server-core-git';
import { TEST_CERTIFICATE_FILES } from '@front-burner/server-core-security/testing';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

export const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' });

/** Bare repositories under `root`: `handbook.git` with `main` and `draft`, and `empty.git`. */
export function createRemotes(root: string): { handbook: string; empty: string; } {
  const work = join(root, 'work');
  const handbook = join(root, 'handbook.git');
  const empty = join(root, 'empty.git');
  mkdirSync(work);
  git(root, 'init', '-q', '--bare', '-b', 'main', handbook);
  git(root, 'init', '-q', '--bare', '-b', 'main', empty);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'first');
  git(work, 'branch', 'draft');
  git(work, 'push', '-q', handbook, 'main', 'draft');
  return { handbook, empty };
}

/** The git engine's options for specs; git trusts the test certificate through `GIT_SSL_CAINFO`. */
export function testGitOptions(overrides: Partial<GitOptions> = {}): GitOptions {
  return {
    helpersDir: join(__dirname, '..', '..', '..', '..', 'core', 'git', 'helpers'),
    egress: { blockPrivateNetworks: false },
    cloneTimeoutMs: 60_000,
    gitTimeoutMs: 60_000,
    knownHosts: [],
    ...overrides
  };
}

/** Makes git trust the test certificate for the current spec file; returns the restore function. */
export function trustTestCertificate(): () => void {
  const saved = process.env['GIT_SSL_CAINFO'];
  process.env['GIT_SSL_CAINFO'] = TEST_CERTIFICATE_FILES.cert;
  return () => {
    if (saved === undefined) {
      delete process.env['GIT_SSL_CAINFO'];
    } else {
      process.env['GIT_SSL_CAINFO'] = saved;
    }
  };
}
