import type { GitRunner } from './git-runner';

/** `socks5h://` proxies on a Unix socket (A-5.7). */
const MINIMUM: [ number, number, number ] = [ 2, 47, 0 ];
const VERSION_TIMEOUT_MS = 10_000;

/**
 * The version of the `git` on the `PATH`.
 *
 * @throws Error when git is missing or prints no version.
 */
export async function gitVersion(runner: GitRunner): Promise<[ number, number, number ]> {
  const result = await runner.run([ 'version' ], { timeoutMs: VERSION_TIMEOUT_MS });
  if (result.exitCode !== 0) {
    throw new Error('git is not installed or cannot be run.');
  }
  const match = /^git version (\d+)\.(\d+)\.(\d+)/.exec(result.stdout);
  if (!match) {
    throw new Error('git printed no version.');
  }
  return [ Number(match[1]), Number(match[2]), Number(match[3]) ];
}

/** @throws Error when git is missing or older than 2.47.0 (A-5.7). */
export async function assertSupportedGit(runner: GitRunner): Promise<void> {
  const version = await gitVersion(runner);
  for (let i = 0; i < MINIMUM.length; i++) {
    const [ actual, minimum ] = [ version[i] ?? 0, MINIMUM[i] ?? 0 ];
    if (actual !== minimum) {
      if (actual > minimum) {
        return;
      }
      throw new Error(`git ${version.join('.')} is too old: ${MINIMUM.join('.')} or later is required.`);
    }
  }
}
