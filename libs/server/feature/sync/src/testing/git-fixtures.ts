import type { GitOptions } from '@front-burner/server-core-git';
import { TEST_CERTIFICATE_FILES } from '@front-burner/server-core-security/testing';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
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
  execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: 'pipe' });

/** A bare repository `handbook.git` under `root`, with one commit on `main`. */
export function createRemote(root: string): string {
  const seed = join(root, 'seed');
  const bare = join(root, 'handbook.git');
  mkdirSync(seed);
  git(root, 'init', '-q', '--bare', '-b', 'main', bare);
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'commit', '-q', '--allow-empty', '-m', 'first');
  git(seed, 'push', '-q', bare, 'main');
  return bare;
}

/** Makes the remote refuse every push with `script`'s output, as a server hook does. */
export function refuseWithHook(bare: string, script: string): void {
  const hook = join(bare, 'hooks', 'pre-receive');
  writeFileSync(hook, `#!/bin/sh\n${script}\nexit 1\n`);
  chmodSync(hook, 0o755);
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
