import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import type { GitRunner } from '../runner/git-runner';

/**
 * Keys that route git around the egress proxy or rewrite where it connects,
 * such as a push URL other than the stored remote (A-5.7). git lower-cases
 * section and variable names, not subsections.
 */
const UNSAFE_KEYS = [
  /^http\.(.+\.)?proxy$/,
  /^http\.(.+\.)?curloptresolve$/,
  /^remote\..+\.proxy$/,
  /^remote\..+\.pushurl$/,
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

/** The local config of a working copy, as one read of it found it. */
export interface LocalConfig {
  /**
   * Every value of `name` in the local config, includes followed, in order:
   * what `git config --local --includes --get-all <name>` gives. The section
   * and variable names match in any case, the subsection exactly.
   */
  values(name: string): string[];
}

/** `section[.subsection].variable` with the section and variable lower-cased, as git prints names. */
function canonicalName(name: string): string {
  const first = name.indexOf('.');
  const last = name.lastIndexOf('.');
  if (first < 0) {
    return name.toLowerCase();
  }
  return `${name.slice(0, first).toLowerCase()}${name.slice(first, last)}${name.slice(last).toLowerCase()}`;
}

/**
 * Refuses a working copy whose local or worktree config, includes followed,
 * holds any key of A-5.7. Run before every network command. Gives the local
 * values from the same read, so that a caller that needs one, such as the
 * remote's URL, starts no second git (plan 160).
 *
 * @throws UnsafeRepositoryConfigError
 */
export async function assertSafeRepositoryConfig(runner: GitRunner, cwd: string): Promise<LocalConfig> {
  const result = await runner.run([ 'config', '--list', '--includes', '--show-scope', '-z' ], {
    cwd,
    timeoutMs: CONFIG_TIMEOUT_MS
  });
  if (result.exitCode !== 0) {
    throw new Error(`The repository's config could not be read: ${result.stderr.trim()}`);
  }
  const keys: string[] = [];
  const local = new Map<string, string[]>();
  // -z: "<scope>\0<name>\n<value>\0" per entry, or "<scope>\0<name>\0" for a key with no value.
  const fields = result.stdout.split('\0');
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [ scope, entry ] = [ fields[i], fields[i + 1] ?? '' ];
    const newline = entry.indexOf('\n');
    const name = newline < 0 ? entry : entry.slice(0, newline);
    if ((scope === 'local' || scope === 'worktree') && UNSAFE_KEYS.some(key => key.test(name.toLowerCase()))) {
      keys.push(name);
    }
    if (scope === 'local') {
      const values = local.get(name) ?? [];
      // A key with no value is "true" to git.
      values.push(newline < 0 ? 'true' : entry.slice(newline + 1));
      local.set(name, values);
    }
  }
  if (keys.length > 0) {
    throw new UnsafeRepositoryConfigError(keys);
  }
  return { values: name => [ ...(local.get(canonicalName(name)) ?? []) ] };
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
