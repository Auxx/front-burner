import { Injectable } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { GitResult, GitRunner } from '../runner/git-runner';
import { GitOperationError } from './git-errors';

/** Paths for a git command that reads NUL-terminated names from its standard input. */
export const nulTerminated = (paths: readonly string[]) => paths.map(path => `${path}\0`).join('');

/** Submodules are not cloned by `--no-recurse-submodules`; these keep LFS from fetching (AR-50). */
export const NO_LFS = [ '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false' ];

/** What a byte of a name that is not valid UTF-8 decodes as, since git's output is read as UTF-8. */
export const UNDECODABLE = '�';

const BRANCH_PREFIX = 'refs/heads/';

/** Commands that read only the working copy and its index. */
export const LOCAL_TIMEOUT_MS = 10_000;

/** Enough for the names of a folder of a few hundred thousand entries; output past it would be lost. */
export const LOCAL_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface LocalRunOptions {
  stdin?: string;
  env?: Record<string, string>;
  /** `FRONT_BURNER_GIT_TIMEOUT` for commands that read whole files, such as `git add` (NF-11.8). */
  timeoutMs?: number;
  /** Per stream; default `LOCAL_MAX_OUTPUT_BYTES`. */
  maxOutputBytes?: number;
}

/** Local git commands of a working copy, shared by the engine and the services built on it. */
@Injectable()
export class LocalGit {
  constructor(private readonly runner: GitRunner) {}

  /** Runs with `LOCAL_TIMEOUT_MS` unless `options` says otherwise. */
  run(cwd: string, args: string[], options: LocalRunOptions = {}): Promise<GitResult> {
    return this.runner.run(args, {
      cwd,
      timeoutMs: options.timeoutMs ?? LOCAL_TIMEOUT_MS,
      stdin: options.stdin,
      env: options.env,
      maxOutputBytes: options.maxOutputBytes ?? LOCAL_MAX_OUTPUT_BYTES
    });
  }

  /**
   * A local command that must succeed; gives its output.
   *
   * @throws GitOperationError `timeout` when it ran out of time.
   */
  async checked(cwd: string, args: string[], options: LocalRunOptions = {}): Promise<string> {
    const result = await this.run(cwd, args, options);
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
    }
    return result.stdout;
  }

  /** Every value of a config key, in order; none when it is not set. */
  async configValues(cwd: string, key: string): Promise<string[]> {
    const result = await this.run(cwd, [ 'config', '--get-all', key ]);
    if (result.timedOut) {
      throw new GitOperationError('timeout', result.stderr);
    }
    if (result.exitCode === 1) {
      return [];
    }
    if (result.exitCode !== 0) {
      throw new Error(`git config --get-all ${key} failed: ${result.stderr.trim()}`);
    }
    return result.stdout.split('\n').filter(line => line !== '');
  }

  /**
   * The branch `HEAD` names, as git follows it, also before that branch's first
   * commit; `null` when `HEAD` is detached or names something else.
   *
   * @throws GitOperationError `timeout` when it ran out of time.
   * @throws Error when git could not read `HEAD`, which is not the same as detached.
   */
  async currentBranch(cwd: string): Promise<string | null> {
    const head = await this.run(cwd, [ 'symbolic-ref', '--quiet', 'HEAD' ]);
    if (head.timedOut) {
      throw new GitOperationError('timeout', head.stderr);
    }
    // With `--quiet`, 1 means only that `HEAD` is not a symbolic ref.
    if (head.exitCode === 1) {
      return null;
    }
    if (head.exitCode !== 0) {
      throw new Error(`git symbolic-ref failed: ${head.stderr.trim()}`);
    }
    const ref = head.stdout.trim();
    return ref.startsWith(BRANCH_PREFIX) ? ref.slice(BRANCH_PREFIX.length) : null;
  }

  /** The ref the branch's upstream has on `origin`, such as `refs/heads/main`, or `null` when it has none there. */
  async upstreamOf(cwd: string, branch: string): Promise<string | null> {
    const [ remote, merge ] = await Promise.all([
      this.configValues(cwd, `branch.${branch}.remote`),
      this.configValues(cwd, `branch.${branch}.merge`)
    ]);
    // As git reads them: the last value wins.
    const ref = merge.at(-1) ?? '';
    return remote.at(-1) === 'origin' && ref.startsWith('refs/heads/') ? ref : null;
  }

  /**
   * A git killed at its timeout cannot remove its `index.lock`; the caller holds
   * the working-tree lock, so no other command of ours is using it, and it is removed.
   */
  async removeStaleIndexLock(cwd: string, failure: unknown): Promise<void> {
    if (failure instanceof GitOperationError && failure.code === 'timeout') {
      await rm(join(cwd, '.git', 'index.lock'), { force: true });
    }
  }
}
