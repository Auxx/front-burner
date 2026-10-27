import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import type { GitRunner } from '../runner/git-runner';

/**
 * Keys that route git around the egress proxy or rewrite where it connects
 * (A-5.7). git lower-cases section and variable names, not subsections.
 */
const UNSAFE_KEYS = [
  /^http\.(.+\.)?proxy$/,
  /^http\.(.+\.)?curloptresolve$/,
  /^remote\..+\.proxy$/,
  /^core\.gitproxy$/,
  /^core\.sshcommand$/,
  /^url\..+\.(push)?insteadof$/,
  /^include\./,
  /^includeif\./
];

const HELPERS = [ 'askpass.cjs', 'proxy-connect.cjs' ];
const CONFIG_TIMEOUT_MS = 10_000;

/** The working copy's config holds keys that could bypass the egress proxy. Names the keys, never their values. */
export class UnsafeRepositoryConfigError extends Error {
  constructor(readonly keys: string[]) {
    super(`The repository's config holds keys that are not allowed: ${keys.join(', ')}`);
    this.name = 'UnsafeRepositoryConfigError';
  }
}

/**
 * Refuses a working copy whose local or worktree config, includes followed,
 * holds any key of A-5.7. Run before every network command.
 *
 * @throws UnsafeRepositoryConfigError
 */
export async function assertSafeRepositoryConfig(runner: GitRunner, cwd: string): Promise<void> {
  const result = await runner.run([ 'config', '--list', '--includes', '--show-scope', '--name-only', '-z' ], {
    cwd,
    timeoutMs: CONFIG_TIMEOUT_MS
  });
  if (result.exitCode !== 0) {
    throw new Error(`The repository's config could not be read: ${result.stderr.trim()}`);
  }
  const keys: string[] = [];
  // -z: "<scope>\0<name>\0" per entry.
  const fields = result.stdout.split('\0');
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [ scope, name ] = [ fields[i], fields[i + 1] ?? '' ];
    if ((scope === 'local' || scope === 'worktree') && UNSAFE_KEYS.some(key => key.test(name.toLowerCase()))) {
      keys.push(name);
    }
  }
  if (keys.length > 0) {
    throw new UnsafeRepositoryConfigError(keys);
  }
}

/** @throws Error naming a helper that is missing or not executable (A-5.4). */
export function assertHelpersExecutable(helpersDir: string): void {
  for (const helper of HELPERS) {
    try {
      accessSync(join(helpersDir, helper), constants.X_OK);
    } catch {
      throw new Error(`The git helper ${join(helpersDir, helper)} is missing or not executable.`);
    }
  }
}
